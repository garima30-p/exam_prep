export async function playThemeSound(theme: 'anime' | 'soft') {
  const audio = new AudioContext();
  try {
    await audio.resume();
    const start = audio.currentTime;
    const duration = theme === 'anime' ? 1.35 : 0.62;
    const volume = audio.createGain();
    volume.connect(audio.destination);
    volume.gain.setValueAtTime(0.001, start);
    volume.gain.exponentialRampToValueAtTime(theme === 'anime' ? 0.38 : 0.12, start + 0.045);
    volume.gain.exponentialRampToValueAtTime(0.001, start + duration);

    let sound: AudioScheduledSourceNode;
    if (theme === 'anime') {
      const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * duration), audio.sampleRate);
      const samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      const rumble = audio.createBufferSource();
      rumble.buffer = buffer;
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1700, start);
      filter.frequency.exponentialRampToValueAtTime(105, start + 0.28);
      rumble.connect(filter).connect(volume);
      sound = rumble;
    } else {
      const voice = audio.createOscillator();
      voice.type = 'sawtooth';
      voice.frequency.setValueAtTime(460, start);
      voice.frequency.exponentialRampToValueAtTime(710, start + 0.18);
      voice.frequency.exponentialRampToValueAtTime(320, start + duration);
      const filter = audio.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.1;
      filter.frequency.setValueAtTime(1400, start);
      filter.frequency.exponentialRampToValueAtTime(660, start + duration);
      voice.connect(filter).connect(volume);
      sound = voice;
    }
    await new Promise<void>(resolve => {
      sound.onended = () => resolve();
      sound.start(start);
      sound.stop(start + duration);
    });
  } finally {
    await audio.close();
  }
}
