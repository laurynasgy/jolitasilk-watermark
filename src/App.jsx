import { useState, useRef, useEffect, useCallback } from 'react'
import JSZip from 'jszip'
import { Upload, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { LOGO_DATA_URL } from './logo'

const CANVAS_SIZE = 1080
const LOGO_PCT    = 0.18
const LOGO_PAD    = 30

// Plural in Lithuanian
function nImages(n) {
  if (n % 10 === 1 && n !== 11) return `${n} nuotrauka`
  if ([2,3,4,5,6,7,8,9].includes(n % 10) && !(n >= 12 && n <= 19)) return `${n} nuotraukos`
  return `${n} nuotraukų`
}

function loadImageFromFile(file) {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.src = e.target.result
    }
    reader.readAsDataURL(file)
  })
}

export default function App() {
  const canvasRef     = useRef(null)
  const logoRef       = useRef(null)
  const gridRef       = useRef(null)

  const [imageQueue,     setImageQueue]     = useState([])  // { img, name, src }
  const [activeIndex,    setActiveIndex]    = useState(null)
  const [processedBlobs, setProcessedBlobs] = useState([])
  const [exportFormat,   setExportFormat]   = useState('webp')
  const [progress,       setProgress]       = useState(null)  // null | { current, total, label, done }
  const [isDragging,     setIsDragging]     = useState(false)
  const [arrowsState,    setArrowsState]    = useState({ left: true, right: true })
  const [jsquashEncode,  setJsquashEncode]  = useState(null)

  // Load logo
  useEffect(() => {
    const img = new Image()
    img.onload = () => { logoRef.current = img }
    img.src = LOGO_DATA_URL
  }, [])

  // Load jsquash encoder
  useEffect(() => {
    import('https://esm.sh/@jsquash/webp/encode')
      .then(mod => setJsquashEncode(() => mod.default))
      .catch(() => {})
  }, [])

  // Render canvas when active image or logo changes
  useEffect(() => {
    if (activeIndex === null || !imageQueue[activeIndex]) return
    renderToCanvas(imageQueue[activeIndex].img)
  }, [activeIndex, imageQueue])

  function renderToCanvas(img) {
    const canvas = canvasRef.current
    if (!canvas || !logoRef.current) return
    const ctx = canvas.getContext('2d')

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Cover-fit main image
    const imgAR = img.width / img.height
    let sw = img.width, sh = img.height, sx = 0, sy = 0
    if (imgAR > 1) { sw = img.height; sx = (img.width - sw) / 2 }
    else           { sh = img.width;  sy = (img.height - sh) / 2 }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Logo bottom-right
    const logo  = logoRef.current
    const logoW = CANVAS_SIZE * LOGO_PCT
    const logoH = logoW / (logo.width / logo.height)
    ctx.globalAlpha = 1.0
    ctx.drawImage(logo, CANVAS_SIZE - logoW - LOGO_PAD, CANVAS_SIZE - logoH - LOGO_PAD, logoW, logoH)
    ctx.globalAlpha = 1
  }

  async function canvasToBlob(mime) {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')
    if (mime === 'image/webp' && jsquashEncode) {
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const buffer    = await jsquashEncode(imageData, { quality: 85 })
      return new Blob([buffer], { type: 'image/webp' })
    }
    return new Promise((resolve) => {
      const quality = mime === 'image/webp' ? 0.92 : undefined
      canvas.toBlob(resolve, mime, quality)
    })
  }

  async function addFiles(files) {
    const newItems = []
    for (const file of files) {
      const img = await loadImageFromFile(file)
      const base = file.name.replace(/\.[^.]+$/, '')
      newItems.push({ img, name: base, src: img.src })
    }
    setImageQueue(prev => {
      const merged = [...prev, ...newItems]
      if (prev.length === 0 && merged.length > 0) {
        setActiveIndex(0)
      }
      return merged
    })
  }

  function handleFileInput(e) {
    const files = Array.from(e.target.files)
    if (files.length) addFiles(files)
    e.target.value = ''
  }

  function handleDrop(e) {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'))
    if (files.length) addFiles(files)
  }

  function selectImage(index) {
    setActiveIndex(index)
  }

  function removeImage(index) {
    setImageQueue(prev => {
      const next = prev.filter((_, i) => i !== index)
      setActiveIndex(cur => {
        if (next.length === 0) return null
        return Math.min(cur ?? 0, next.length - 1)
      })
      return next
    })
    setProcessedBlobs([])
  }

  function clearAll() {
    setImageQueue([])
    setActiveIndex(null)
    setProcessedBlobs([])
    setProgress(null)
  }

  async function handleGenerate() {
    if (!imageQueue.length || !logoRef.current) return
    setProcessedBlobs([])
    setProgress({ current: 0, total: imageQueue.length, label: 'Pradedama…', done: false })

    const blobs = []
    for (let i = 0; i < imageQueue.length; i++) {
      const item = imageQueue[i]
      setProgress({ current: i + 1, total: imageQueue.length, label: `Apdorojama ${i + 1} iš ${imageQueue.length} — ${item.name}`, done: false })

      renderToCanvas(item.img)
      await new Promise(r => setTimeout(r, 0))

      if (exportFormat === 'both') {
        blobs.push({ name: item.name + '.webp', blob: await canvasToBlob('image/webp') })
        blobs.push({ name: item.name + '.png',  blob: await canvasToBlob('image/png') })
      } else {
        const mime = exportFormat === 'png' ? 'image/png' : 'image/webp'
        const ext  = exportFormat === 'png' ? '.png' : '.webp'
        blobs.push({ name: item.name + ext, blob: await canvasToBlob(mime) })
      }
    }

    setProcessedBlobs(blobs)
    setProgress({ current: imageQueue.length, total: imageQueue.length, label: `Atlikta — ${blobs.length} nuotraukų apdorota`, done: true })
  }

  async function handleDownload() {
    if (!processedBlobs.length) return
    const zip = new JSZip()
    processedBlobs.forEach(({ name, blob }) => zip.file(name, blob))
    const zipBlob = await zip.generateAsync({ type: 'blob' })
    const url  = URL.createObjectURL(zipBlob)
    const link = document.createElement('a')
    link.href     = url
    link.download = 'watermarked.zip'
    link.click()
    URL.revokeObjectURL(url)
  }

  function updateArrows() {
    const el = gridRef.current
    if (!el) return
    setArrowsState({
      left:  el.scrollLeft <= 0,
      right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    })
  }

  function scrollGrid(dir) {
    gridRef.current?.scrollBy({ left: dir * (80 + 8) * 3, behavior: 'smooth' })
  }

  const canGenerate = imageQueue.length > 0 && !!logoRef.current
  const isProcessing = progress && !progress.done
  const progressPct = progress ? (progress.current / progress.total) * 100 : 0

  return (
    <div className="min-h-screen bg-[#FEF7F5] px-6 py-12 flex flex-col items-center font-sans">
      <h1 className="text-3xl font-semibold tracking-tight text-[#4a4a4a] mb-8">
        Jolita Silk vandenženklio įrankis
      </h1>

      <div className="flex gap-8 w-full max-w-5xl items-start max-sm:flex-col max-sm:gap-5">

        {/* ── Controls ── */}
        <div className="flex flex-col gap-5 w-[280px] shrink-0 max-sm:w-full">

          {/* Upload */}
          <div className="bg-white rounded-xl p-5 border border-[#e8e6e2]">
            <label className="block text-xs font-semibold tracking-widest uppercase text-[#888] mb-3">
              Nuotraukos
            </label>
            <label
              className={`relative flex flex-col items-center gap-2 border-[1.5px] border-dashed rounded-lg px-3 py-5 text-center cursor-pointer transition-colors ${isDragging ? 'border-[#c8a97e] bg-[#faf8f5]' : 'border-[#d0cdc8] hover:border-[#c8a97e] hover:bg-[#faf8f5]'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                accept="image/*"
                multiple
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                onChange={handleFileInput}
              />
              <Upload size={24} className="text-[#bbb]" />
              <span className="text-sm text-[#aaa] text-balance">Spauskite arba įvilkite nuotraukas čia</span>
            </label>
          </div>

          {/* Format */}
          <div className="bg-white rounded-xl p-5 border border-[#e8e6e2]">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold tracking-widest uppercase text-[#888]">
                Eksporto formatas
              </label>
              <div className="flex gap-1.5">
                {['webp', 'png', 'both'].map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => setExportFormat(fmt)}
                    className={`flex-1 py-2 px-1 rounded-lg border-[1.5px] text-sm font-medium cursor-pointer transition-all ${exportFormat === fmt ? 'border-[#1a1a1a] bg-[#1a1a1a] text-white' : 'border-[#e0ddd8] bg-white text-[#888] hover:border-[#c8a97e]'}`}
                  >
                    {fmt === 'both' ? 'Abu' : fmt.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Action buttons (desktop) */}
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isProcessing}
            className="w-full py-3.5 rounded-xl bg-[#1a1a1a] text-white font-semibold text-[15px] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform max-sm:hidden"
          >
            {isProcessing ? 'Apdorojama…' : 'Apdoroti visas'}
          </button>
          {processedBlobs.length > 0 && (
            <button
              onClick={handleDownload}
              className="w-full py-3.5 rounded-xl bg-[#c8a97e] text-white font-semibold text-[15px] cursor-pointer active:scale-[0.98] transition-transform max-sm:hidden"
            >
              Atsisiųsti ZIP
            </button>
          )}
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-xl border border-[#e8e6e2] p-4 flex flex-col gap-4">

            {/* Canvas / placeholder */}
            <div className="flex items-center justify-center w-full pb-6 min-h-[320px]">
              {activeIndex === null && (
                <div className="flex flex-col items-center gap-2.5 text-[#ccc]">
                  <ImageIcon size={48} className="opacity-40" />
                  <p className="text-sm">Pasirinkite nuotraukas peržiūrai</p>
                </div>
              )}
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className={`rounded max-w-full w-auto h-auto ${activeIndex === null ? 'hidden' : ''}`}
                style={{ maxHeight: 'calc(100vh - 380px)' }}
              />
            </div>

            {/* Progress */}
            {progress && (
              <div className="bg-white rounded-xl border border-[#e8e6e2] px-4 py-3.5">
                <p className="text-sm text-[#555] mb-2">{progress.label}</p>
                <div className="h-1.5 bg-[#e8e6e2] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#c8a97e] rounded-full transition-[width] duration-200"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>
            )}

            {/* Image queue */}
            {imageQueue.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold tracking-widest uppercase text-[#888]">
                    {nImages(imageQueue.length)}
                  </span>
                  <button
                    onClick={clearAll}
                    className="text-xs text-[#aaa] bg-none border-none cursor-pointer px-1.5 py-0.5 rounded hover:text-[#e05c5c] transition-colors"
                  >
                    Išvalyti viską
                  </button>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <button
                    onClick={() => scrollGrid(-1)}
                    disabled={arrowsState.left}
                    className="shrink-0 w-8 h-8 rounded-full border-[1.5px] border-[#e0ddd8] bg-white text-[#555] cursor-pointer flex items-center justify-center transition-colors hover:border-[#c8a97e] hover:text-[#c8a97e] disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:border-[#e0ddd8] disabled:hover:text-[#555] max-sm:hidden"
                    aria-label="Scroll left"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <div
                    ref={gridRef}
                    className="flex flex-row gap-2 overflow-x-auto scroll-snap-x pb-1 flex-1"
                    style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
                    onScroll={updateArrows}
                  >
                    {imageQueue.map((item, i) => {
                      const isDone = processedBlobs.some(b => b.name.startsWith(item.name))
                      return (
                        <div
                          key={i}
                          onClick={() => selectImage(i)}
                          className={`relative w-20 h-20 shrink-0 rounded-lg overflow-hidden cursor-pointer border-2 transition-colors bg-[#e8e6e2] scroll-snap-start ${activeIndex === i ? 'border-[#c8a97e]' : 'border-transparent'}`}
                          style={{ scrollSnapAlign: 'start' }}
                        >
                          <img src={item.src} alt="" className="w-full h-full object-cover block" />
                          {isDone && (
                            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-semibold">
                              ✓
                            </div>
                          )}
                          <button
                            onClick={(e) => { e.stopPropagation(); removeImage(i) }}
                            className="absolute top-0.5 right-0.5 w-[18px] h-[18px] rounded-full bg-black/55 text-white border-none cursor-pointer text-[11px] flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity max-sm:opacity-100"
                            aria-label="Pašalinti"
                          >
                            ×
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  <button
                    onClick={() => scrollGrid(1)}
                    disabled={arrowsState.right}
                    className="shrink-0 w-8 h-8 rounded-full border-[1.5px] border-[#e0ddd8] bg-white text-[#555] cursor-pointer flex items-center justify-center transition-colors hover:border-[#c8a97e] hover:text-[#c8a97e] disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:border-[#e0ddd8] disabled:hover:text-[#555] max-sm:hidden"
                    aria-label="Scroll right"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

      {/* ── Mobile sticky CTA ── */}
      {imageQueue.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 flex flex-col gap-2.5 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-[rgba(254,247,245,0.92)] backdrop-blur-md border-t border-[#e8e6e2] z-50 sm:hidden">
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isProcessing}
            className="w-full py-4 rounded-xl bg-[#1a1a1a] text-white font-semibold text-base cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-transform"
          >
            {isProcessing ? 'Apdorojama…' : 'Apdoroti visas'}
          </button>
          {processedBlobs.length > 0 && (
            <button
              onClick={handleDownload}
              className="w-full py-4 rounded-xl bg-[#c8a97e] text-white font-semibold text-base cursor-pointer active:scale-[0.98] transition-transform"
            >
              Atsisiųsti ZIP
            </button>
          )}
        </div>
      )}
    </div>
  )
}
