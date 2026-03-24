import { useState, useRef, useEffect } from 'react'
import JSZip from 'jszip'
import { Upload, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { LOGO_DATA_URL } from './logo'
import { Button } from '@/components/ui/button'
import { Progress, ProgressLabel } from '@/components/ui/progress'

const CANVAS_SIZE = 1080
const LOGO_PCT    = 0.18
const LOGO_PAD    = 30

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
  const canvasRef  = useRef(null)
  const logoRef    = useRef(null)
  const gridRef    = useRef(null)

  const [imageQueue,     setImageQueue]     = useState([])
  const [activeIndex,    setActiveIndex]    = useState(null)
  const [processedBlobs, setProcessedBlobs] = useState([])
  const [exportFormat,   setExportFormat]   = useState('webp')
  const [progress,       setProgress]       = useState(null)
  const [isDragging,     setIsDragging]     = useState(false)
  const [arrowsState,    setArrowsState]    = useState({ left: true, right: true })
  const [jsquashEncode,  setJsquashEncode]  = useState(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => { logoRef.current = img }
    img.src = LOGO_DATA_URL
  }, [])

  useEffect(() => {
    import('https://esm.sh/@jsquash/webp/encode')
      .then(mod => setJsquashEncode(() => mod.default))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeIndex === null || !imageQueue[activeIndex]) return
    renderToCanvas(imageQueue[activeIndex].img)
  }, [activeIndex, imageQueue])

  useEffect(() => {
    setTimeout(updateArrows, 50)
  }, [imageQueue])

  function renderToCanvas(img) {
    const canvas = canvasRef.current
    if (!canvas || !logoRef.current) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const imgAR = img.width / img.height
    let sw = img.width, sh = img.height, sx = 0, sy = 0
    if (imgAR > 1) { sw = img.height; sx = (img.width - sw) / 2 }
    else           { sh = img.width;  sy = (img.height - sh) / 2 }
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, CANVAS_SIZE, CANVAS_SIZE)
    const logo  = logoRef.current
    const logoW = CANVAS_SIZE * LOGO_PCT
    const logoH = logoW / (logo.width / logo.height)
    ctx.drawImage(logo, CANVAS_SIZE - logoW - LOGO_PAD, CANVAS_SIZE - logoH - LOGO_PAD, logoW, logoH)
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
      canvas.toBlob(resolve, mime, mime === 'image/webp' ? 0.92 : undefined)
    })
  }

  async function addFiles(files) {
    const newItems = []
    for (const file of files) {
      const img = await loadImageFromFile(file)
      newItems.push({ img, name: file.name.replace(/\.[^.]+$/, ''), src: img.src })
    }
    setImageQueue(prev => {
      const merged = [...prev, ...newItems]
      if (prev.length === 0 && merged.length > 0) setActiveIndex(0)
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

  function removeImage(index) {
    setImageQueue(prev => {
      const next = prev.filter((_, i) => i !== index)
      setActiveIndex(cur => next.length === 0 ? null : Math.min(cur ?? 0, next.length - 1))
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
        blobs.push({ name: item.name + (exportFormat === 'png' ? '.png' : '.webp'), blob: await canvasToBlob(mime) })
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
    link.href = url; link.download = 'watermarked.zip'; link.click()
    URL.revokeObjectURL(url)
  }

  function updateArrows() {
    const el = gridRef.current
    if (!el) return
    setArrowsState({ left: el.scrollLeft <= 0, right: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 })
  }

  const canGenerate  = imageQueue.length > 0 && !!logoRef.current
  const isProcessing = progress && !progress.done
  const progressPct  = progress ? (progress.current / progress.total) * 100 : 0

  return (
    <>
    <div className="min-h-screen bg-[#FEF7F5] px-6 py-12 flex flex-col items-center max-sm:px-4 max-sm:pt-7 max-sm:pb-36">
      <h1 className="text-3xl font-semibold tracking-tight text-[#4a4a4a] mb-8 max-sm:text-[22px]">
        Jolita Silk vandenženklio įrankis
      </h1>

      <div className="flex gap-8 w-full max-w-5xl items-start max-sm:flex-col max-sm:gap-5">

        {/* ── Controls ── */}
        <div className="flex flex-col gap-5 w-[280px] shrink-0 max-sm:w-full">

          {/* Upload */}
          <div className="bg-card rounded-xl p-5 border">
            <label className="block text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
              Nuotraukos
            </label>
            <label
              className={`relative flex flex-col items-center gap-2 border-[1.5px] border-dashed rounded-lg px-3 py-5 text-center cursor-pointer transition-colors ${isDragging ? 'border-primary bg-muted/50' : 'border-border hover:border-primary/50 hover:bg-muted/30'}`}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
            >
              <input type="file" accept="image/*" multiple className="absolute inset-0 opacity-0 cursor-pointer w-full h-full" onChange={handleFileInput} />
              <Upload size={24} className="text-muted-foreground/50" />
              <span className="text-sm text-muted-foreground/70 text-balance">Spauskite arba įvilkite nuotraukas čia</span>
            </label>
          </div>

          {/* Format toggle */}
          <div className="bg-card rounded-xl p-5 border">
            <label className="block text-xs font-semibold tracking-widest uppercase text-muted-foreground mb-3">
              Eksporto formatas
            </label>
            <div className="flex gap-1.5">
              {['webp', 'png', 'both'].map(fmt => (
                <Button
                  key={fmt}
                  variant={exportFormat === fmt ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => setExportFormat(fmt)}
                >
                  {fmt === 'both' ? 'Abu' : fmt.toUpperCase()}
                </Button>
              ))}
            </div>
          </div>

          {/* Action buttons (desktop) */}
          <div className="flex flex-col gap-2 max-sm:hidden">
            <Button
              size="lg"
              className="w-full"
              onClick={handleGenerate}
              disabled={!canGenerate || isProcessing}
            >
              {isProcessing ? 'Apdorojama…' : 'Apdoroti visas'}
            </Button>
            {processedBlobs.length > 0 && (
              <Button
                size="lg"
                variant="outline" className="w-full"
                onClick={handleDownload}
              >
                Atsisiųsti ZIP
              </Button>
            )}
          </div>
        </div>

        {/* ── Right panel ── */}
        <div className="flex-1 min-w-0 w-full overflow-hidden">
          <div className="bg-card rounded-xl border p-4 flex flex-col gap-4">

            {/* Canvas / placeholder */}
            <div className={`flex items-center justify-center w-full ${activeIndex === null ? 'min-h-[320px]' : 'py-4'}`}>
              {activeIndex === null && (
                <div className="flex flex-col items-center gap-2.5 text-muted-foreground/40">
                  <ImageIcon size={48} />
                  <p className="text-sm">Pasirinkite nuotraukas peržiūrai</p>
                </div>
              )}
              <canvas
                ref={canvasRef}
                width={CANVAS_SIZE}
                height={CANVAS_SIZE}
                className={`aspect-square rounded max-w-full w-auto h-auto ${activeIndex === null ? 'hidden' : ''}`}
                style={{ maxHeight: 'min(calc(100vh - 380px), calc(100vw - 64px))' }}
              />
            </div>

            {/* Progress */}
            {progress && (
              <div className="rounded-xl border px-4 py-3.5">
                <Progress value={progressPct} className="w-full">
                  <ProgressLabel className="text-sm text-muted-foreground">{progress.label}</ProgressLabel>
                </Progress>
              </div>
            )}

            {/* Image queue */}
            {imageQueue.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold tracking-widest uppercase text-muted-foreground">
                    {nImages(imageQueue.length)}
                  </span>
                  <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-destructive h-auto py-0.5 px-1.5">
                    Išvalyti viską
                  </Button>
                </div>
                <div className="mt-2.5 flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { gridRef.current?.scrollBy({ left: -(80 + 8) * 3, behavior: 'smooth' }) }}
                    disabled={arrowsState.left}
                    className="shrink-0 max-sm:hidden"
                    aria-label="Scroll left"
                  >
                    <ChevronLeft size={16} />
                  </Button>
                  <div
                    ref={gridRef}
                    className="flex flex-row gap-2 overflow-x-auto pb-1 flex-1"
                    style={{ scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}
                    onScroll={updateArrows}
                  >
                    {imageQueue.map((item, i) => {
                      const isDone = processedBlobs.some(b => b.name.startsWith(item.name))
                      return (
                        <div
                          key={i}
                          onClick={() => setActiveIndex(i)}
                          className={`relative w-20 h-20 shrink-0 rounded-lg overflow-hidden cursor-pointer border-2 transition-colors bg-muted max-sm:w-[68px] max-sm:h-[68px] ${activeIndex === i ? 'border-primary' : 'border-transparent'}`}
                          style={{ scrollSnapAlign: 'start' }}
                        >
                          <img src={item.src} alt="" className="w-full h-full object-cover block" />
                          {isDone && (
                            <div className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-2xl font-semibold">✓</div>
                          )}
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            onClick={(e) => { e.stopPropagation(); removeImage(i) }}
                            className="absolute top-0.5 right-0.5 bg-black/55 text-white hover:bg-black/70 hover:text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity max-sm:opacity-100 size-[18px] min-w-0"
                            aria-label="Pašalinti"
                          >
                            ×
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { gridRef.current?.scrollBy({ left: (80 + 8) * 3, behavior: 'smooth' }) }}
                    disabled={arrowsState.right}
                    className="shrink-0 max-sm:hidden"
                    aria-label="Scroll right"
                  >
                    <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
            )}

          </div>
        </div>
      </div>

    </div>

    {/* ── Mobile sticky CTA ── */}
    {imageQueue.length > 0 && (
      <div className="fixed bottom-0 left-0 right-0 flex flex-col gap-2.5 px-4 py-3 pb-[calc(12px+env(safe-area-inset-bottom))] bg-white border-t border-[#e8e6e2] z-50 sm:hidden">
        <Button
          size="lg"
          className="w-full h-auto py-4 text-base"
          onClick={handleGenerate}
          disabled={!canGenerate || isProcessing}
        >
          {isProcessing ? 'Apdorojama…' : 'Apdoroti visas'}
        </Button>
        {processedBlobs.length > 0 && (
          <Button
            variant="outline"
            size="lg"
            className="w-full h-auto py-4 text-base"
            onClick={handleDownload}
          >
            Atsisiųsti ZIP
          </Button>
        )}
      </div>
    )}
    </>
  )
}
