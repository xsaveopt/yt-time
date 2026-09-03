import { QUALITY_CHANGE_EVENT, QUALITY_SET_EVENT } from "./shared.ts";

type YouTubePlayer = Element & {
  getPlaybackQuality?: () => string;
  setPlaybackQuality?: (quality: string) => void;
  getAvailableQualityLevels?: () => string[];
  addEventListener(
    event: "onPlaybackQualityChange",
    listener: (event: { data?: string }) => void,
  ): void;
};

const findPlayer = (): YouTubePlayer | null =>
  document.querySelector<YouTubePlayer>("#movie_player");

const notifyQuality = (event: { data?: string }): void => {
  const quality = event.data ?? findPlayer()?.getPlaybackQuality?.();
  if (!quality) return;
  document.dispatchEvent(new CustomEvent(QUALITY_CHANGE_EVENT, { detail: quality }));
};

let bound: YouTubePlayer | null = null;

const bind = (): void => {
  const player = findPlayer();
  if (!player || player === bound || !player.addEventListener) return;
  bound = player;
  player.addEventListener("onPlaybackQualityChange", notifyQuality);
};

document.addEventListener(QUALITY_SET_EVENT, (event) => {
  const quality = (event as CustomEvent<string>).detail;
  if (typeof quality !== "string") return;
  const player = findPlayer();
  const available = player?.getAvailableQualityLevels?.() ?? [];
  if (!available.includes(quality)) return;
  player?.setPlaybackQuality?.(quality);
});

setInterval(bind, 1000);
bind();
