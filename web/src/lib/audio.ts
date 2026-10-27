/**
 * Microphone capture tuned for speech-to-text.
 *
 * Codec choice matters on mobile: Safari only produces `audio/mp4` (AAC) while
 * Chromium prefers Opus in WebM. We negotiate rather than assume.
 */
const PREFERRED_TYPES = [
	"audio/webm;codecs=opus",
	"audio/webm",
	"audio/ogg;codecs=opus",
	"audio/mp4;codecs=mp4a.40.2",
	"audio/mp4",
	"audio/aac",
];

export interface RecorderCallbacks {
	onLevel?: (level: number) => void;
	onStateChange?: (state: "idle" | "recording" | "stopping") => void;
	onError?: (message: string) => void;
}

export class VoiceRecorder {
	private stream: MediaStream | null = null;
	private recorder: MediaRecorder | null = null;
	private chunks: Blob[] = [];
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private rafId: number | null = null;
	private mimeType = "";
	private callbacks: RecorderCallbacks;
	private startedAt = 0;

	constructor(callbacks: RecorderCallbacks = {}) {
		this.callbacks = callbacks;
	}

	static get supported(): boolean {
		return (
			typeof navigator !== "undefined" &&
			!!navigator.mediaDevices?.getUserMedia &&
			typeof MediaRecorder !== "undefined"
		);
	}

	get recording(): boolean {
		return this.recorder?.state === "recording";
	}

	get elapsedMs(): number {
		return this.startedAt ? Date.now() - this.startedAt : 0;
	}

	async start(): Promise<void> {
		if (this.recording) return;

		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: {
					// Voice-optimised constraints; ignored where unsupported.
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true,
					channelCount: 1,
				},
			});
		} catch (error) {
			const name = (error as DOMException)?.name;
			if (name === "NotAllowedError" || name === "SecurityError") {
				throw new Error("麦克风权限被拒绝，请在浏览器设置中允许后重试");
			}
			if (name === "NotFoundError" || name === "DevicesNotFoundError") {
				throw new Error("没有检测到麦克风设备");
			}
			throw new Error("无法打开麦克风");
		}

		this.stream = stream;
		this.chunks = [];
		this.mimeType = pickMimeType();

		const recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
		this.recorder = recorder;
		this.mimeType = recorder.mimeType || this.mimeType || "audio/webm";

		recorder.ondataavailable = (event) => {
			if (event.data && event.data.size > 0) this.chunks.push(event.data);
		};
		recorder.onerror = () => {
			this.callbacks.onError?.("录音出错");
		};

		recorder.start(250);
		this.startedAt = Date.now();
		this.callbacks.onStateChange?.("recording");
		this.startMeter(stream);
	}

	async stop(): Promise<Blob> {
		const recorder = this.recorder;
		if (!recorder) throw new Error("未在录音");

		this.callbacks.onStateChange?.("stopping");

		const blob = await new Promise<Blob>((resolve, reject) => {
			const timeout = window.setTimeout(() => reject(new Error("录音结束超时")), 8000);
			recorder.onstop = () => {
				window.clearTimeout(timeout);
				const type = this.mimeType || "audio/webm";
				resolve(new Blob(this.chunks, { type }));
			};
			try {
				recorder.stop();
			} catch (error) {
				window.clearTimeout(timeout);
				reject(error instanceof Error ? error : new Error("停止录音失败"));
			}
		});

		this.teardown();
		this.callbacks.onStateChange?.("idle");
		return blob;
	}

	cancel(): void {
		try {
			if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
		} catch {
			/* ignore */
		}
		this.chunks = [];
		this.teardown();
		this.callbacks.onStateChange?.("idle");
	}

	private startMeter(stream: MediaStream): void {
		try {
			const AudioCtor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
			const context = new AudioCtor();
			const source = context.createMediaStreamSource(stream);
			const analyser = context.createAnalyser();
			analyser.fftSize = 1024;
			analyser.smoothingTimeConstant = 0.75;
			source.connect(analyser);
			this.audioContext = context;
			this.analyser = analyser;

			const buffer = new Uint8Array(analyser.fftSize);
			const tick = () => {
				if (!this.analyser) return;
				this.analyser.getByteTimeDomainData(buffer);
				let sum = 0;
				for (let i = 0; i < buffer.length; i += 1) {
					const centered = (buffer[i] - 128) / 128;
					sum += centered * centered;
				}
				const rms = Math.sqrt(sum / buffer.length);
				// Map perceptually: speech sits around 0.02–0.25 RMS.
				const level = Math.min(1, Math.pow(rms * 3.4, 0.65));
				this.callbacks.onLevel?.(level);
				this.rafId = requestAnimationFrame(tick);
			};
			this.rafId = requestAnimationFrame(tick);
		} catch {
			/* Metering is cosmetic; recording still works. */
		}
	}

	private teardown(): void {
		if (this.rafId !== null) {
			cancelAnimationFrame(this.rafId);
			this.rafId = null;
		}
		if (this.analyser) {
			this.analyser.disconnect();
			this.analyser = null;
		}
		if (this.audioContext) {
			void this.audioContext.close().catch(() => undefined);
			this.audioContext = null;
		}
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
			this.stream = null;
		}
		this.recorder = null;
		this.startedAt = 0;
		this.callbacks.onLevel?.(0);
	}
}

function pickMimeType(): string {
	if (typeof MediaRecorder === "undefined") return "";
	for (const type of PREFERRED_TYPES) {
		try {
			if (MediaRecorder.isTypeSupported(type)) return type;
		} catch {
			/* ignore */
		}
	}
	return "";
}

export function extensionForMime(mimeType: string): string {
	if (mimeType.includes("mp4")) return "m4a";
	if (mimeType.includes("ogg")) return "ogg";
	if (mimeType.includes("wav")) return "wav";
	return "webm";
}
