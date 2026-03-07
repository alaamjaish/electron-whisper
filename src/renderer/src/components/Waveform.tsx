import { useEffect, useRef } from 'react'

interface WaveformProps {
  audioLevel: number
  isActive: boolean
}

export default function Waveform({ audioLevel, isActive }: WaveformProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const barsRef = useRef<number[]>(new Array(24).fill(0.03))
  const frameRef = useRef<number>(0)

  useEffect(() => {
    if (!isActive) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const draw = (): void => {
      const bars = barsRef.current
      bars.shift()
      // Add some organic variance
      const variance = Math.random() * 0.12
      bars.push(Math.min(1, audioLevel * 0.85 + variance))

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const totalBars = bars.length
      const gap = 2
      const barWidth = (canvas.width - gap * (totalBars - 1)) / totalBars
      const centerY = canvas.height / 2

      for (let i = 0; i < totalBars; i++) {
        const level = bars[i]
        const barHeight = Math.max(2, level * canvas.height * 0.85)
        const x = i * (barWidth + gap)
        const y = centerY - barHeight / 2

        const alpha = 0.25 + Math.min(1, level * 1.5) * 0.55

        ctx.beginPath()
        ctx.roundRect(x, y, barWidth, barHeight, barWidth / 2)
        ctx.fillStyle = `rgba(160, 163, 170, ${alpha})`
        ctx.fill()
      }

      frameRef.current = requestAnimationFrame(draw)
    }

    draw()
    return (): void => cancelAnimationFrame(frameRef.current)
  }, [audioLevel, isActive])

  return <canvas ref={canvasRef} width={140} height={28} className="opacity-90" />
}
