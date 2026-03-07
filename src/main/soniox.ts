import WebSocket from 'ws'

interface SonioxToken {
  text: string
  is_final: boolean
}

interface SonioxResponse {
  tokens: SonioxToken[]
  finished?: boolean
  error_code?: number
  error_message?: string
}

// Single callback with full hypothesis text (committed + pending)
type HypothesisCallback = (fullText: string) => void
type FinishCallback = (fullText: string) => void

export class SonioxClient {
  private ws: WebSocket | null = null
  private apiKey: string
  private sampleRate: number
  private onHypothesis: HypothesisCallback
  private onFinish: FinishCallback
  private committedText = '' // All finalized text so far
  private audioChunksSent = 0
  private audioBuffer: Buffer[] = []
  private ready = false

  constructor(
    apiKey: string,
    sampleRate: number,
    onHypothesis: HypothesisCallback,
    onFinish: FinishCallback
  ) {
    this.apiKey = apiKey
    this.sampleRate = sampleRate
    this.onHypothesis = onHypothesis
    this.onFinish = onFinish
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('[SONIOX] Connecting...')
      this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
      this.committedText = ''
      this.audioChunksSent = 0
      this.audioBuffer = []
      this.ready = false

      this.ws.on('open', () => {
        const config = {
          api_key: this.apiKey,
          model: 'stt-rt-v4',
          audio_format: 'pcm_s16le',
          sample_rate: this.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true
        }
        this.ws!.send(JSON.stringify(config))
        this.ready = true

        // Flush any audio that arrived while connecting
        if (this.audioBuffer.length > 0) {
          console.log(`[SONIOX] Flushing ${this.audioBuffer.length} buffered chunks`)
          for (const chunk of this.audioBuffer) {
            this.ws!.send(chunk)
          }
          this.audioChunksSent += this.audioBuffer.length
          this.audioBuffer = []
        }

        console.log(`[SONIOX] Connected! (sample_rate: ${this.sampleRate})`)
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const response: SonioxResponse = JSON.parse(data.toString())

          if (response.error_code || response.error_message) {
            console.error(`[SONIOX] Error: ${response.error_code} - ${response.error_message}`)
            return
          }

          if (response.finished) {
            console.log(
              `[SONIOX] Finished. Transcript: ${this.committedText.trim().length} chars`
            )
            this.onFinish(this.committedText.trim())
            return
          }

          if (response.tokens && response.tokens.length > 0) {
            let newFinalText = ''
            let pendingText = ''

            for (const token of response.tokens) {
              if (token.text.startsWith('<') && token.text.endsWith('>')) {
                continue
              }
              if (token.is_final) {
                newFinalText += token.text
              } else {
                pendingText += token.text
              }
            }

            // Accumulate finalized text
            if (newFinalText) {
              this.committedText += newFinalText
            }

            // Send FULL hypothesis = all committed text + current pending
            // This way the typing system only ever sees the complete text growing
            const fullHypothesis = this.committedText + pendingText
            if (fullHypothesis.length > 0) {
              this.onHypothesis(fullHypothesis)
            }
          }
        } catch (err) {
          console.error('[SONIOX] Parse error:', err)
        }
      })

      this.ws.on('error', (err) => {
        console.error('[SONIOX] WebSocket error:', err)
        reject(err)
      })

      this.ws.on('close', (code) => {
        console.log(`[SONIOX] Closed (code: ${code})`)
        this.ws = null
      })
    })
  }

  sendAudio(chunk: Buffer): void {
    if (!this.ws) return

    if (this.ready && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(chunk)
      this.audioChunksSent++
      if (this.audioChunksSent === 1) {
        console.log(`[SONIOX] Streaming audio... (chunk size: ${chunk.length})`)
      }
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.audioBuffer.push(chunk)
    }
  }

  stop(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log(`[SONIOX] Stop signal sent (${this.audioChunksSent} chunks streamed)`)
      this.ws.send('')
    }
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }
}
