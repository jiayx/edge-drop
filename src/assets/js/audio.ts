// audio.ts — minimal streaming audio player helper

export function createAudioPlayer(src: string, container: HTMLElement): HTMLAudioElement {
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "none";
  audio.src = src;
  audio.style.width = "100%";
  audio.style.maxWidth = "320px";
  container.appendChild(audio);
  return audio;
}
