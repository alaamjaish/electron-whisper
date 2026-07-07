import WebSocket from 'ws'
import { log } from './logger'

interface SonioxToken {
  text: string
  is_final: boolean
}

interface SonioxResponse {
  tokens?: SonioxToken[]
  finished?: boolean
  error_code?: number
  error_message?: string
}

type HypothesisCallback = (fullText: string) => void
type FinishCallback = (fullText: string) => void
type FailureCallback = (reason: string) => void

const CONNECT_TIMEOUT_MS = 6000

export class SonioxClient {
  private ws: WebSocket | null = null
  private apiKey: string
  private sampleRate: number
  private onHypothesis: HypothesisCallback
  private onFinish: FinishCallback
  private onFailure: FailureCallback
  private committedText = ''
  private audioChunksSent = 0
  private audioBuffer: Buffer[] = []
  private ready = false
  private messageCount = 0
  private connectSettled = false
  private manuallyClosing = false
  private stopping = false

  constructor(
    apiKey: string,
    sampleRate: number,
    onHypothesis: HypothesisCallback,
    onFinish: FinishCallback,
    onFailure: FailureCallback
  ) {
    this.apiKey = apiKey
    this.sampleRate = sampleRate
    this.onHypothesis = onHypothesis
    this.onFinish = onFinish
    this.onFailure = onFailure
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      log('SONIOX', 'Connecting to wss://stt-rt.soniox.com/transcribe-websocket ...')
      this.ws = new WebSocket('wss://stt-rt.soniox.com/transcribe-websocket')
      this.committedText = ''
      this.audioChunksSent = 0
      this.audioBuffer = []
      this.ready = false
      this.messageCount = 0
      this.connectSettled = false
      this.manuallyClosing = false
      this.stopping = false

      const connectTimeout = setTimeout(() => {
        const message = `Soniox connection timed out after ${CONNECT_TIMEOUT_MS}ms`
        log('SONIOX', message)
        if (!this.connectSettled) {
          this.connectSettled = true
          reject(new Error(message))
        } else {
          this.onFailure(message)
        }
        this.ws?.terminate()
      }, CONNECT_TIMEOUT_MS)

      const fail = (reason: string, err?: unknown): void => {
        const fullReason = err ? `${reason}: ${err}` : reason
        log('SONIOX', fullReason)
        if (!this.connectSettled) {
          clearTimeout(connectTimeout)
          this.connectSettled = true
          reject(err instanceof Error ? err : new Error(fullReason))
          return
        }
        if (!this.manuallyClosing && !this.stopping) {
          this.onFailure(fullReason)
        }
      }

      this.ws.on('open', () => {
        const config = {
          api_key: this.apiKey,
          model: 'stt-rt-v5',
          audio_format: 'pcm_s16le',
          sample_rate: this.sampleRate,
          num_channels: 1,
          enable_endpoint_detection: true
        }

        log('SONIOX', `Sending config: model=${config.model}, sample_rate=${config.sample_rate}, format=${config.audio_format}`)
        try {
          this.ws!.send(JSON.stringify(config))
          this.ready = true
        } catch (err) {
          fail('Failed to send Soniox config', err)
          return
        }

        if (this.audioBuffer.length > 0) {
          log('SONIOX', `Flushing ${this.audioBuffer.length} buffered audio chunks`)
          for (const chunk of this.audioBuffer) {
            try {
              this.ws!.send(chunk)
            } catch (err) {
              fail('Failed to flush buffered audio', err)
              return
            }
          }
          this.audioChunksSent += this.audioBuffer.length
          this.audioBuffer = []
        }

        clearTimeout(connectTimeout)
        this.connectSettled = true
        log('SONIOX', 'WebSocket OPEN - ready to receive audio')
        resolve()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const response = JSON.parse(data.toString()) as SonioxResponse
          this.messageCount++

          if (response.error_code || response.error_message) {
            fail(`Server error code=${response.error_code} msg="${response.error_message}"`)
            return
          }

          if (response.finished) {
            log('SONIOX', `Server says FINISHED after ${this.messageCount} messages`)
            log('SONIOX', `Final committed text (${this.committedText.trim().length} chars): "${this.committedText.trim().substring(0, 200)}"`)
            this.onFinish(this.committedText.trim())
            return
          }

          if (response.tokens && response.tokens.length > 0) {
            let newFinalText = ''
            let pendingText = ''
            const finalTokens: string[] = []
            const pendingTokens: string[] = []

            for (const token of response.tokens) {
              if (token.text.startsWith('<') && token.text.endsWith('>')) {
                log('SONIOX', `Special token: ${token.text}`)
                continue
              }
              if (token.is_final) {
                newFinalText += token.text
                finalTokens.push(token.text)
              } else {
                pendingText += token.text
                pendingTokens.push(token.text)
              }
            }

            if (newFinalText) {
              this.committedText += newFinalText
              log('SONIOX', `FINAL tokens: [${finalTokens.map((t) => `"${t}"`).join(', ')}]`)
            }
            if (pendingTokens.length > 0) {
              log('SONIOX', `Pending: "${pendingText}"`)
            }

            const fullHypothesis = this.committedText + pendingText
            if (fullHypothesis.length > 0) {
              this.onHypothesis(fullHypothesis)
            }
          }
        } catch (err) {
          fail('Parse error', err)
        }
      })

      this.ws.on('error', (err) => {
        fail('WebSocket error', err)
      })

      this.ws.on('close', (code) => {
        log('SONIOX', `WebSocket CLOSED (code: ${code}), ${this.messageCount} messages received, ${this.audioChunksSent} audio chunks sent`)
        clearTimeout(connectTimeout)
        this.ws = null
        if (!this.connectSettled) {
          this.connectSettled = true
          reject(new Error(`Soniox WebSocket closed before opening (code ${code})`))
          return
        }
        if (!this.manuallyClosing && !this.stopping) {
          this.onFailure(`Soniox WebSocket closed unexpectedly (code ${code})`)
        }
      })
    })
  }

  sendAudio(chunk: Buffer): void {
    if (!this.ws) return

    if (this.ready && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(chunk)
        this.audioChunksSent++
        if (this.audioChunksSent === 1) {
          log('SONIOX', `First audio chunk sent (${chunk.length} bytes) - streaming started`)
        }
      } catch (err) {
        const reason = `Failed to send audio chunk: ${err}`
        log('SONIOX', reason)
        if (!this.manuallyClosing && !this.stopping) {
          this.onFailure(reason)
        }
      }
    } else if (this.ws.readyState === WebSocket.CONNECTING) {
      this.audioBuffer.push(chunk)
      if (this.audioBuffer.length % 10 === 1) {
        log('SONIOX', `Buffering audio (WS still connecting)... ${this.audioBuffer.length} chunks buffered`)
      }
    }
  }

  stop(): void {
    this.stopping = true
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      log('SONIOX', `Sending STOP signal (${this.audioChunksSent} chunks were streamed)`)
      try {
        this.ws.send('')
      } catch (err) {
        log('SONIOX', `Failed to send stop signal: ${err}`)
      }
    } else {
      log('SONIOX', `Stop called but WS not open (readyState=${this.ws?.readyState})`)
    }
  }

  disconnect(): void {
    if (this.ws) {
      log('SONIOX', 'Closing WebSocket connection')
      this.manuallyClosing = true
      this.ws.close()
      this.ws = null
    }
  }

  // Kill a client whose connection attempt failed without firing any further
  // callbacks (terminate() still emits error/close events asynchronously).
  abandon(): void {
    this.manuallyClosing = true
    this.stopping = true
    if (this.ws) {
      this.ws.terminate()
      this.ws = null
    }
  }
}
