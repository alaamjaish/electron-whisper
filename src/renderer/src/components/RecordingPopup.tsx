import { useState, useEffect, useRef } from 'react'

function errorToMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`
  return String(err)
}

function isVirtualOrSilentProne(label: string): boolean {
  const lower = label.toLowerCase()
  return (
    lower.includes('default -') ||
    lower.includes('communications -') ||
    lower.includes('ai noise') ||
    lower.includes('noise-cancelling') ||
    lower.includes('noise cancelling') ||
    lower.includes('asus utility') ||
    lower.includes('virtual') ||
    lower.includes('nvidia') ||
    lower.includes('broadcast') ||
    lower.includes('stereo mix') ||
    lower.includes('obs')
  )
}

function scoreInputDevice(device: MediaDeviceInfo): number {
  const label = device.label.toLowerCase()
  let score = 0

  if (isVirtualOrSilentProne(device.label)) score -= 100
  if (label.includes('microphone')) score += 25
  if (label.includes('array')) score += 20
  if (label.includes('realtek')) score += 18
  if (label.includes('logi') || label.includes('webcam')) score += 12
  if (device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications') score += 5

  return score
}

function pickInputDevice(devices: MediaDeviceInfo[]): MediaDeviceInfo | null {
  const inputs = devices.filter((device) => device.kind === 'audioinput')
  if (inputs.length === 0) return null

  return [...inputs].sort((a, b) => scoreInputDevice(b) - scoreInputDevice(a))[0]
}

export default function RecordingPopup(): React.JSX.Element {
  const [audioLevel, setAudioLevel] = useState(0)
  const [isRecording, setIsRecording] = useState(false)
  const [sonioxStatus, setSonioxStatus] = useState('connecting')
  const [elapsed, setElapsed] = useState(0)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const animFrameRef = useRef<number>(0)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const mountedRef = useRef(true)
  const cleaningUpRef = useRef(false)
  const sentAudioStartedRef = useRef(false)
  const reportedErrorRef = useRef(false)
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
    cleaningUpRef.current = false
    sentAudioStartedRef.current = false
    reportedErrorRef.current = false

    const reportMicError = (message: string): void => {
      if (reportedErrorRef.current) return
      reportedErrorRef.current = true
      console.error('[RENDERER] Mic error:', message)
      window.api.sendMicError(message)
    }

    const cleanup = (): void => {
      cleaningUpRef.current = true

      if (processorRef.current) {
        processorRef.current.disconnect()
        processorRef.current.onaudioprocess = null
        processorRef.current = null
      }

      streamRef.current?.getTracks().forEach((track) => track.stop())

      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close().catch((err) => {
          console.error('[RENDERER] Failed to close AudioContext:', err)
        })
      }

      cancelAnimationFrame(animFrameRef.current)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }

      streamRef.current = null
      audioContextRef.current = null
      setIsRecording(false)
      setAudioLevel(0)
      setElapsed(0)
    }

    const startCapture = async (): Promise<void> => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('getUserMedia is not available')
        }

        const settings = await window.api.getSettings()

        const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        const devices = await navigator.mediaDevices.enumerateDevices()
        const inputDevices = devices.filter((device) => device.kind === 'audioinput')
        window.api.sendMicDevices(
          inputDevices.map((device) => `${device.label || '(unlabeled audio input)'} [${device.deviceId}]`)
        )

        // A mic explicitly chosen in Settings wins; auto-scoring is the fallback
        // (also when the chosen device is unplugged).
        const preferredDevice = settings.micDeviceId
          ? inputDevices.find((device) => device.deviceId === settings.micDeviceId) ?? null
          : null
        const selectedDevice = preferredDevice ?? pickInputDevice(devices)
        window.api.sendMicDevice(
          selectedDevice
            ? `${selectedDevice.label || '(unlabeled audio input)'} [${selectedDevice.deviceId}]`
            : '(browser default)'
        )

        permissionStream.getTracks().forEach((track) => track.stop())

        const audioConstraint: MediaTrackConstraints = {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }

        if (
          selectedDevice?.deviceId &&
          selectedDevice.deviceId !== 'default' &&
          selectedDevice.deviceId !== 'communications'
        ) {
          audioConstraint.deviceId = { exact: selectedDevice.deviceId }
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint
        })

        if (!mountedRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        stream.getAudioTracks().forEach((track) => {
          track.addEventListener('ended', () => {
            if (mountedRef.current && !cleaningUpRef.current) {
              reportMicError('Microphone track ended unexpectedly')
            }
          })
        })

        streamRef.current = stream
        const audioContext = new AudioContext()
        audioContextRef.current = audioContext

        audioContext.onstatechange = (): void => {
          if (!mountedRef.current || cleaningUpRef.current) return
          if (audioContext.state === 'suspended') {
            audioContext.resume().catch((err) => {
              reportMicError(`AudioContext resume failed after suspend: ${errorToMessage(err)}`)
            })
          }
          if (audioContext.state === 'closed') {
            reportMicError('AudioContext closed unexpectedly')
          }
        }

        if (audioContext.state === 'suspended') {
          await audioContext.resume()
        }

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
          if (!mountedRef.current || cleaningUpRef.current) return
          if (audioContext.state !== 'running') {
            audioContext.resume().catch((err) => {
              reportMicError(`AudioContext resume failed while processing: ${errorToMessage(err)}`)
            })
            return
          }

          if (!sentAudioStartedRef.current) {
            sentAudioStartedRef.current = true
            window.api.sendAudioStarted()
          }

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
          if (!mountedRef.current || cleaningUpRef.current) return
          analyser.getByteFrequencyData(dataArray)

          const avg = dataArray.reduce((sum, val) => sum + val, 0) / dataArray.length
          setAudioLevel(avg / 255)

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
        reportMicError(errorToMessage(err))
        cleanup()
      }
    }

    startCapture()

    window.api.onRecordingStateChange((state) => {
      if (state === 'stopped' || state === 'error') cleanup()
    })

    window.api.onSonioxStatus((status) => {
      setSonioxStatus(status)
    })

    return (): void => {
      mountedRef.current = false
      cleanup()
      window.api.removeAllListeners('recording-state')
      window.api.removeAllListeners('soniox-status')
    }
  }, [])

  // Dot color doubles as connection state: amber while the Soniox link is
  // connecting/retrying, red once transcription is live.
  const live = sonioxStatus === 'connected'
  const dotRgb = live ? '239,68,68' : '245,158,11'

  return (
    <div
      className="w-full h-full select-none cursor-grab active:cursor-grabbing"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div className="w-full h-full rounded-[12px] bg-[#1a1a1a]/90 border border-white/[0.08] backdrop-blur-2xl flex items-center px-2.5 gap-2">
        <div className="relative flex items-center justify-center shrink-0" style={{ width: 10, height: 10 }}>
          {isRecording && (
            <div
              className="absolute rounded-full"
              style={{
                width: `${8 + audioLevel * 6}px`,
                height: `${8 + audioLevel * 6}px`,
                backgroundColor: `rgba(${dotRgb},${0.15 + audioLevel * 0.2})`,
                transition: 'all 0.1s ease-out'
              }}
            />
          )}
          <div
            className="w-[6px] h-[6px] rounded-full"
            style={{
              backgroundColor: isRecording ? `rgb(${dotRgb})` : '#555',
              boxShadow: isRecording
                ? `0 0 ${3 + audioLevel * 6}px rgba(${dotRgb},${0.5 + audioLevel * 0.5})`
                : 'none',
              transition: 'box-shadow 0.1s ease-out'
            }}
          />
        </div>

        <canvas
          ref={canvasRef}
          width={90}
          height={36}
          className="flex-1"
          style={{ height: 18 }}
        />

        <span className="text-white/60 text-[10px] font-mono shrink-0 tabular-nums leading-none">
          {formatTime(elapsed)}
        </span>
      </div>
    </div>
  )
}
