# Voice & Telephony

Real-time voice input and output. Four channels cover the matrix: inbound calls, local microphone wake, outbound speech synthesis, and SIP-grade real-time conversation.

## ClawdTalk (real-time SIP)

Full-duplex SIP voice powered by Telnyx. The agent talks over a real phone call (inbound or outbound). Supports barge-in, mid-turn tool use, and regional number provisioning.

{{#config-fields channels.clawdtalk}}

`api_key` (Telnyx) and `webhook_secret` are secrets:

{{#secret-config channels.clawdtalk.<alias>.api_key}}

**Pair with:** a `telnyx` model provider for the brain and ensure your Telnyx account has a SIP connection with the correct webhook URL pointed at the ZeroClaw gateway.

## Voice Call (Twilio / Telnyx / Plivo)

Traditional carrier voice: the agent picks up, transcribes the caller, replies with TTS. Higher latency than ClawdTalk but works with any regular phone number and doesn't require SIP trunk provisioning. Outbound calls hit `from_number` and require operator approval when `require_outbound_approval` is on.

{{#config-fields channels.voice_call}}

## Voice Wake (local wake-word)

Runs locally, listens on the mic, triggers agent interaction when it hears the wake phrase. Useful for:

- Physical voice assistants on SBCs
- Desktop "hotword → ask" workflows
- Always-listening home-automation agents

The agent doesn't send audio anywhere; wake detection is local. Only post-wake speech is captured and (separately) transcribed before reaching the LLM.

{{#config-fields channels.voice_wake}}

> **Build flag:** Voice Wake is gated by the `voice-wake` cargo feature on `zeroclaw-channels`. Build with `--features voice-wake` to include it.
> On Android, Voice Wake requires Android 8 (API level 26) or newer.

## TTS (outbound speech synthesis)

TTS is an output service channels call into, not its own inbound channel. Global defaults live under `tts`. TTS provider instances are configured under `providers.tts.<type>.<alias>` (OpenAI, ElevenLabs, Google, Edge, Piper, SiliconFlow) and selected per agent via the agent's `tts_provider`. See [Model Providers](../providers/overview.md) for the provider entries and per-agent wiring. Provider API keys are secrets; set them through the gateway, zerocode, or `zeroclaw config set`, never in plaintext.

### SiliconFlow

`[providers.tts.siliconflow.<alias>]` targets SiliconFlow's OpenAI-compatible speech endpoint (`https://api.siliconflow.cn/v1/audio/speech`; override with `uri`). The default model is `FunAudioLLM/CosyVoice2-0.5B` and voices are model-qualified — a bare `voice = "alex"` is sent as `FunAudioLLM/CosyVoice2-0.5B:alex`, while an already-qualified voice passes through verbatim. The response is MP3 by default; an explicit `response_format` (and optional `speed`) rides on the request only when configured, and `response_format` also names the delivered audio file's extension.

### Voice replies on WeChat

The WeChat channel delivers TTS replies as **audio file messages** (`voice.mp3`), which WeChat renders with an inline audio player. The iLink send flow defines media uploads for image, video, and file only — the protocol's voice item is inbound-shaped, so there is no native bot-sent voice bubble to construct. Voice replies trigger in two ways: send the agent a voice note and the next reply mirrors that modality once, or list a contact in a peer group with `output_modality = "voice"` for a durable voice-only route. Replies that are URLs, JSON, code, or errors stay text; a synthesis failure falls back to text so the reply is never lost.

---

## Latency budget

Speech feels real-time below ~500 ms end-to-end. Practical budgets:

| Component | Typical latency |
|---|---|
| Wake detection (local) | <100 ms |
| STT (Whisper local) | 300–800 ms per utterance |
| LLM first-token | 100–2000 ms (model dependent) |
| TTS first-audio | 200–700 ms |
| Network (cellular / PSTN) | 100–300 ms RTT |

ClawdTalk shortcuts several of these by keeping the audio stream live; regular `voice_call` incurs STT + LLM + TTS sequentially.

## STT

Speech-to-text is configured separately from the voice channels; see the `[transcription]` config in the [Config reference](../reference/config.md). Voice channels invoke whichever transcription provider is active when they need to turn audio into text.

## Hardware notes

For always-on voice on an SBC:

- USB mic: any UAC-compliant mic works. `arecord -l` to verify the OS sees it.
- Speaker: either USB audio out or the SBC's onboard jack; pick the OS default device for the user the daemon runs as.
- Microphones with built-in AEC (acoustic echo cancellation) dramatically improve wake reliability when the speaker is nearby.

See [Hardware → Android](../hardware/android-setup.md) for Android-specific audio setup.
