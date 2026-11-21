type Sound = 'click' | 'thunder' | 'swish' | 'impact' | 'meow';

const effects = {
  click: { duration: .06, volume: .05, pitch: [520, 310], filter: [950, 740], type: 'lowpass' },
  thunder: { duration: 1.08, volume: .31, filter: [1550, 90], type: 'lowpass' },
  swish: { duration: .37, volume: .15, filter: [4500, 650], type: 'bandpass' },
  impact: { duration: .55, volume: .24, pitch: [135, 38], filter: [440, 120], type: 'lowpass' },
  meow: { duration: .56, volume: .11, pitch: [440, 680, 310], filter: [1450, 660], type: 'bandpass' },
} as const;

export async function playThemeSound(effect: Sound) {
  const audio = new AudioContext();
  try {
    await audio.resume();
    const start = audio.currentTime;
    const { duration, volume, filter, type } = effects[effect];
    const end = start + duration;
    const gain = audio.createGain();
    gain.connect(audio.destination);
    gain.gain.setValueAtTime(.001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + Math.min(.035, duration / 4));
    gain.gain.exponentialRampToValueAtTime(.001, end);

    const tone = audio.createBiquadFilter();
    tone.type = type;
    tone.Q.value = 1.1;
    tone.frequency.setValueAtTime(filter[0], start);
    tone.frequency.exponentialRampToValueAtTime(filter[1], start + duration * .75);
    tone.connect(gain);

    const preset = effects[effect];
    let source: AudioScheduledSourceNode;
    if ('pitch' in preset) {
      const oscillator = audio.createOscillator();
      oscillator.type = effect === 'meow' ? 'sawtooth' : 'triangle';
      oscillator.frequency.setValueAtTime(preset.pitch[0], start);
      preset.pitch.slice(1).forEach((pitch, index) =>
        oscillator.frequency.exponentialRampToValueAtTime(pitch, start + duration * (index + 1) / (preset.pitch.length - 1)));
      source = oscillator;
    } else {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
      const noise = audio.createBufferSource();
      noise.buffer = buffer;
      source = noise;
    }
    source.connect(tone);
    await new Promise<void>(resolve => {
      source.onended = () => resolve();
      source.start(start);
      source.stop(end);
    });
  } finally {
    await audio.close();
  }
}
