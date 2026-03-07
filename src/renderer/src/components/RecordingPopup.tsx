import { useState, useEffect, useRef } from 'react'

export default function RecordingPopup(): React.JSX.Element {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mountedRef = useRef(true)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const smoothBarsRef = useRef<number[]>(new Array(5).fill(0.08))
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isRecording) {
      setElapsed(0)
      timerRef.current = setInterval(() => setElapsed((p) => p + 1), 1000)
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [isRecording])

  const formatTime = (s: number): string => {
    const m = Math.floor(s / 60)
    return `${m}:${(s % 60).toString().padStart(2, '0')}`
  }

  useEffect(() => {
    mountedRef.current = true

    const startCapture = async (): Promise<void> => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
        })

        if (!mountedRef.current) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }

        streamRef.current = stream
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext
        const actualSampleRate = audioContext.sampleRate
        window.api.sendSampleRate(actualSampleRate)

        const source = audioContext.createMediaStreamSource(stream)

        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source.connect(analyser)

        const processor = audioContext.createScriptProcessor(4096, 1, 1)
        processorRef.current = processor
        source.connect(processor)
        processor.connect(audioContext.destination)

        processor.onaudioprocess = (event): void => {
          if (!mountedRef.current) return
          const float32Data = event.inputBuffer.getChannelData(0)
          const int16Data = new Int16Array(float32Data.length)
          for (let i = 0; i < float32Data.length; i++) {
            const s = Math.max(-1, Math.min(1, float32Data[i]))
            int16Data[i] = s < 0 ? s * 0x8000 : s * 0x7fff
          }
          window.api.sendAudioChunk(int16Data.buffer)
        }

        const dataArray = new Uint8Array(analyser.frequencyBinCount)
        const barCount = 5
        const smoothBars = smoothBarsRef.current

        const updateLevel = (): void => {
          if (!mountedRef.current) return
          analyser.getByteFrequencyData(dataArray)

          const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length
          setAudioLevel(avg / 255)

          // Sample 5 frequency bands from voice range
          const binCount = dataArray.length
          const voiceBins = Math.floor(binCount * 0.4)
          const binsPerBar = Math.max(1, Math.floor(voiceBins / barCount))

          for (let i = 0; i < barCount; i++) {
            let sum = 0
            const start = i * binsPerBar
            for (let j = start; j < start + binsPerBar && j < binCount; j++) {
              sum += dataArray[j]
            }
            const target = Math.max(0.1, sum / binsPerBar / 255)
            smoothBars[i] = smoothBars[i] * 0.55 + target * 0.45
          }

          const canvas = canvasRef.current
          if (canvas) {
            const ctx = canvas.getContext('2d')
            if (ctx) {
              const w = canvas.width
              const h = canvas.height
              ctx.clearRect(0, 0, w, h)

              const gap = 5
              const barWidth = (w - gap * (barCount - 1)) / barCount
              const centerY = h / 2
              const radius = barWidth / 2

              for (let i = 0; i < barCount; i++) {
                const barH = Math.max(barWidth, smoothBars[i] * h * 0.92)
                const x = i * (barWidth + gap)

                ctx.beginPath()
                ctx.roundRect(x, centerY - barH / 2, barWidth, barH, radius)
                ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.min(0.5, smoothBars[i] * 0.9)})`
                ctx.fill()
              }
            }
          }

          animFrameRef.current = requestAnimationFrame(updateLevel)
        }
        updateLevel()

        setIsRecording(true)
        window.api.sendMicReady()
      } catch (err) {
        console.error('[RENDERER] Mic error:', err)
      }
    }

    startCapture()

    window.api.onRecordingStateChange((state) => {
      if (state === 'stopped') cleanup()
    })

    const cleanup = (): void => {
      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current = null
      }
      streamRef.current?.getTracks().forEach((t) => t.stop())
      audioContextRef.current?.close()
      cancelAnimationFrame(animFrameRef.current)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      streamRef.current = null
      audioContextRef.current = null
      setIsRecording(false)
      setAudioLevel(0)
    }

    return (): void => {
      mountedRef.current = false
      cleanup()
      window.api.removeAllListeners('recording-state')
    }
  }, [])

  return (
    <div
      className="w-full h-full select-none cursor-grab active:cursor-grabbing"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="w-full h-full rounded-[12px] bg-[#1a1a1a]/90 border border-white/[0.08] backdrop-blur-2xl flex items-center px-2.5 gap-2">
        {/* Dot */}
        <div className="relative flex items-center justify-center shrink-0" style={{ width: 10, height: 10 }}>
          {isRecording && (
            <div
              className="absolute rounded-full"
              style={{
                width: `${8 + audioLevel * 6}px`,
                height: `${8 + audioLevel * 6}px`,
                backgroundColor: `rgba(239,68,68,${0.15 + audioLevel * 0.2})`,
                transition: 'all 0.1s ease-out'
              }}
            />
          )}
          <div
            className="w-[6px] h-[6px] rounded-full"
            style={{
              backgroundColor: isRecording ? '#ef4444' : '#555',
              boxShadow: isRecording
                ? `0 0 ${3 + audioLevel * 6}px rgba(239,68,68,${0.5 + audioLevel * 0.5})`
                : 'none',
              transition: 'box-shadow 0.1s ease-out'
            }}
          />
        </div>

        {/* Waveform — 5 bars, 2x canvas */}
        <canvas
          ref={canvasRef}
          width={90}
          height={36}
          className="flex-1"
          style={{ height: 18 }}
        />

        {/* Timer */}
        <span className="text-white/60 text-[10px] font-mono shrink-0 tabular-nums leading-none">
          {formatTime(elapsed)}
        </span>
      </div>
    </div>
  )
}
