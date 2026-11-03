import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { DebugPlayer } from 'components/DebugPlayer';
import type { RenderBackend } from '@vr-player/player';
import { Toaster, toast } from 'react-hot-toast';
import { UI } from './ui/UI';
import { VrPlayer } from 'components/VrPlayer';
import {
  autoDetectAtom,
  autoPlayAtom,
  debugAtom,
  detectingAtom,
  flipLayoutAtom,
  formatAtom,
  layoutAtom,
  videoUrlAtom,
} from 'atoms/controls';
import { getImageFrames } from 'helper/getImageFrames';
import { transfer, wrap } from 'comlink';
import { useAtom, useSetAtom } from 'jotai';
import { useDropzone } from 'react-dropzone';
import { useEffect, useRef, useState } from 'react';
import { useXRSession } from 'hooks/useXRSession';
import clsx from 'clsx';
import type { VideoRecognitionWorker } from 'worker/videoRecognition.worker';
import { flushSync } from 'react-dom';

const worker = wrap<VideoRecognitionWorker>(
  new Worker(
    new URL('worker/videoRecognition.worker/index.ts', import.meta.url),
    {
      type: 'module',
    },
  ),
);

function shuffleFiles(files: File[]): string[] {
  const names = files.map((file) => file.name);

  for (let i = names.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [names[i], names[j]] = [names[j], names[i]];
  }

  return names;
}

function createLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const runNext = () => {
    if (active >= concurrency || queue.length === 0) {
      return;
    }

    active++;

    const task = queue.shift()!;

    task();
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        void task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            runNext();
          });
      });

      runNext();
    });
  };
}




function getVideoMetadata(
  file: File
): Promise<{ duration: number; aspectRatio: number }> {
  return new Promise((resolve) => {
    const id = Math.random().toString(36).slice(2, 8);
    const started = performance.now();

    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;
    let heartbeat: ReturnType<typeof setInterval>;

    const fallback = {
      duration: 0,
      aspectRatio: 16 / 9,
    };

    const log = (event: string) => {
      const buffered = [];

      for (let i = 0; i < video.buffered.length; i++) {
        buffered.push({
          start: video.buffered.start(i),
          end: video.buffered.end(i),
        });
      }

      console.log(`[Metadata ${id}] ${event}`, {
        elapsed: Math.round(performance.now() - started),
        fileName: file.name,
        sizeMB: (file.size / 1024 / 1024).toFixed(2),
        readyState: video.readyState,
        networkState: video.networkState,
        error: video.error?.code ?? null,
        duration: video.duration,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        buffered,
      });
    };

    const cleanup = () => {
      clearTimeout(timeout);
      clearInterval(heartbeat);

      video.onloadedmetadata = null;
      video.onerror = null;
      video.onstalled = null;
      video.onabort = null;
      video.onprogress = null;
      video.onwaiting = null;
      video.onloadstart = null;

      video.pause();
      video.removeAttribute('src');
      video.load();

      URL.revokeObjectURL(url);
    };

    const finish = (
      result: { duration: number; aspectRatio: number }
    ) => {
      if (finished) return;

      finished = true;

      log('FINISHED');
      cleanup();

      resolve(result);
    };

    timeout = setTimeout(() => {
      log('TIMEOUT');
      finish(fallback);
    }, 30000);

    heartbeat = setInterval(() => {
      log('HEARTBEAT');
    }, 3000);

    log('START');

    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    video.onloadstart = () => log('LOADSTART');
    video.onprogress = () => log('PROGRESS');
    video.onstalled = () => log('STALLED');
    video.onwaiting = () => log('WAITING');

    video.onabort = () => {
      log('ABORTED');
      finish(fallback);
    };

    video.onerror = () => {
      log('ERROR');
      finish(fallback);
    };

    video.onloadedmetadata = () => {
      log('LOADED METADATA');

      finish({
        duration: Number.isFinite(video.duration)
          ? video.duration
          : 0,

        aspectRatio:
          video.videoWidth > 0 && video.videoHeight > 0
            ? video.videoWidth / video.videoHeight
            : 16 / 9,
      });
    };

    video.src = url;

    log('SOURCE SET');

    video.load();

    log('LOAD CALLED');
  });
}


export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugContainerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const currentObjectUrlRef = useRef<string | null>(null);

  const [layout, setLayout] = useAtom(layoutAtom);
  const [flipLayout] = useAtom(flipLayoutAtom);
  const [format, setFormat] = useAtom(formatAtom);
  const [debug, setDebug] = useAtom(debugAtom);
  const [autoPlay] = useAtom(autoPlayAtom);
  const [autoDetect] = useAtom(autoDetectAtom);
  const [renderBackend, setRenderBackend] =  useState<RenderBackend>('webgpu');

  const [videoUrl, setVideoUrl] = useAtom(videoUrlAtom);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);
  const [gallerySearch, setGallerySearch] = useState('');
  const [gallerySort, setGallerySort] = useState<   | 'name-asc'  | 'name-desc'  | 'newest'  | 'oldest'  | 'longest'  | 'shortest'| 'random'>('name-asc');
  const [galleryDurations, setGalleryDurations] = useState<Record<string, number>>({});

  const [, xrSession] = useXRSession();
  const setDetecting = useSetAtom(detectingAtom);

  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<Record<string, string>>({});
  const [galleryThumbnails, setGalleryThumbnails] = useState<Record<string, string>>({});
  const [urlInput, setUrlInput] = useState('');
  type VideoSource = 'file' | 'url' | 'gallery' | null;
  const [videoSource, setVideoSource] =  useState<VideoSource>(null);
  const [showGallerySearch, setShowGallerySearch] = useState(false);
  const toggleGallerySearch = () => {if (showGallerySearch) {setGallerySearch('');} setShowGallerySearch((previous) => !previous);};
  const [randomOrder, setRandomOrder] = useState<string[]>([]);  
  const [galleryAspectRatios, setGalleryAspectRatios] = useState<Record<string, number>>({});

  const normalizedSearch = gallerySearch.trim().toLocaleLowerCase();
  const galleryPreviewRef = useRef<HTMLVideoElement>(null);
  const hoveredVideoRef = useRef<string | null>(null);
  const hoveredCardRef = useRef<HTMLDivElement | null>(null);




const handleGalleryMouseEnter = (
  file: File,
  card: HTMLDivElement
) => {
  const video = galleryPreviewRef.current;
  const url = galleryUrls[file.name];

  if (!video || !url) return;

  if (hoveredVideoRef.current === file.name) return;

  hoveredVideoRef.current = file.name;
  hoveredCardRef.current = card;

  const thumbnail = card.querySelector('.gallery-thumbnail');
  
  if (thumbnail) {
	thumbnail.style.opacity = '1';
 }

  // Keep thumbnail visible until video has a decoded frame
  video.pause();
  video.onloadeddata = null;
  video.onplaying = null;

  const rect = card.getBoundingClientRect();

	Object.assign(video.style, {
	  position: 'fixed',
	  left: `${rect.left}px`,
	  top: `${rect.top}px`,
	  width: `${rect.width}px`,
	  height: `${rect.height}px`,
	  zIndex: '9999',
	  display: 'block',
	  opacity: '0',
	  transition: 'opacity 400ms ease',
	  pointerEvents: 'none',
	  objectFit: 'cover',
	  backgroundColor: 'transparent',
	});

  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';

  video.onloadeddata = () => {
    if (hoveredVideoRef.current !== file.name) return;

    // Start from the beginning after the first frame is available
    video.currentTime = 0;
  };

  video.onseeked = () => {
    if (hoveredVideoRef.current !== file.name) return;

    void video.play().catch((error) => {
      console.warn('[Gallery] Preview playback failed:', error);
    });
  };

video.onplaying = () => {
  if (hoveredVideoRef.current !== file.name) return;

  const thumbnail = card.querySelector(
    '.gallery-thumbnail'
  ) as HTMLImageElement | null;

  // Make sure video starts transparent
  video.style.opacity = '0';

  // Fade in video
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      video.style.opacity = '1';
    });
  });

  // Fade out thumbnail
  if (thumbnail) {
    thumbnail.style.transition = 'opacity 600ms ease-in-out';
    thumbnail.style.opacity = '0';
  }
};

  video.onerror = () => {
    console.error('[Gallery] Preview video error:', {
      file: file.name,
      error: video.error,
    });
  };

  video.src = url;
  video.load();
};

const handleGalleryMouseLeave = () => {
  const video = galleryPreviewRef.current;
  const card = hoveredCardRef.current;

  if (!video) return;

  hoveredVideoRef.current = null;

  // Fade video OUT
  video.style.transition = 'opacity 600ms ease-in-out';
  video.style.opacity = '0';

  // Fade thumbnail IN
  if (card) {
    const thumbnail = card.querySelector(
      '.gallery-thumbnail'
    ) as HTMLImageElement | null;

    if (thumbnail) {
      thumbnail.style.transition = 'opacity 600ms ease-in-out';
      thumbnail.style.opacity = '1';
    }
  }

  // Wait until fade-out finishes
  setTimeout(() => {
    if (hoveredVideoRef.current !== null) return;
	hoveredCardRef.current = null;

    video.pause();
    video.onloadeddata = null;
    video.onplaying = null;
    video.onseeked = null;

    video.removeAttribute('src');
    video.load();

    video.style.display = 'none';
    video.style.position = '';
    video.style.left = '';
    video.style.top = '';
    video.style.width = '';
    video.style.height = '';
    video.style.opacity = '';
    video.style.transition = '';
    video.style.zIndex = '';
  }, 600);
};


const updatePreviewPosition = () => {
  const video = galleryPreviewRef.current;
  const card = hoveredCardRef.current;

  if (!video || !card) return;

  const rect = card.getBoundingClientRect();

  video.style.position = 'fixed';
  video.style.left = `${rect.left}px`;
  video.style.top = `${rect.top}px`;
  video.style.width = `${rect.width}px`;
  video.style.height = `${rect.height}px`;
};

useEffect(() => {
  window.addEventListener('scroll', updatePreviewPosition, true);
  window.addEventListener('resize', updatePreviewPosition);

  return () => {
    window.removeEventListener('scroll', updatePreviewPosition, true);
    window.removeEventListener('resize', updatePreviewPosition);
  };
}, []);

const visibleGalleryFiles = galleryFiles
  .filter((file) =>
    file.name.toLocaleLowerCase().includes(normalizedSearch),
  )
  .sort((a, b) => {
    if (gallerySort === 'random') {
      const aIndex = randomOrder.indexOf(a.name);
      const bIndex = randomOrder.indexOf(b.name);

      return aIndex - bIndex;
    }

    switch (gallerySort) {
      case 'name-desc':
        return b.name.localeCompare(a.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });

      case 'newest':
        return b.lastModified - a.lastModified;

      case 'oldest':
        return a.lastModified - b.lastModified;

      case 'longest':
        return (galleryDurations[b.name] ?? 0) -
          (galleryDurations[a.name] ?? 0);

      case 'shortest':
        return (galleryDurations[a.name] ?? 0) -
          (galleryDurations[b.name] ?? 0);

      case 'name-asc':
      default:
        return a.name.localeCompare(b.name, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
    }
  });
	  
	  const getVideoDuration = (file: File): Promise<number> =>
  new Promise((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);

    const cleanup = () => {
	  video.pause();
	  video.removeAttribute('src');
	  video.load();

	  canvas.width = 0;
	  canvas.height = 0;

	  URL.revokeObjectURL(url);
	};

    video.preload = 'auto';

    video.onloadedmetadata = () => {
      const duration = video.duration;
      cleanup();
      resolve(Number.isFinite(duration) ? duration : 0);
    };

    video.onerror = () => {
      cleanup();
      resolve(0);
    };

    video.src = url;
  });


  /*
   * ---------------------------------------------------------
   * LOAD VIDEO
   * ---------------------------------------------------------
   */

const loadVideo = (url: string) => {
  const video = videoRef.current;

  if (!video) return;

  console.log('[App] Loading video:', url);

  video.pause();

  setReady(false);
  setPlaying(false);
  setCurrentTime(0);
  setDuration(0);

  video.src = url;
  video.load();

  setVideoUrl(url);
};
  /*
   * ---------------------------------------------------------
   * FILE VIA DRAG & DROP
   * ---------------------------------------------------------
   */

const handleVideoFile = (selectedFile: File) => {
  console.log('Selected file:', selectedFile);

  if (!selectedFile.type.startsWith('video/')) {
    toast.error('Please select a video file.');
    return;
  }

  if (currentObjectUrlRef.current) {
    URL.revokeObjectURL(currentObjectUrlRef.current);
  }

  const objectUrl = URL.createObjectURL(selectedFile);

  currentObjectUrlRef.current = objectUrl;

  setVideoSource('file');

  loadVideo(objectUrl);
};


  /*
   * ---------------------------------------------------------
   * VIDEO THUMBNAIL
   * ---------------------------------------------------------
   */



const createVideoThumbnail = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true,});

    if (!context) {
      URL.revokeObjectURL(url);
      reject(new Error('Could not create thumbnail canvas'));
      return;
    }

    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';

    let timestamps: number[] = [];
    let currentAttempt = 0;
    let lastThumbnail = '';
	let finished = false;
	let timeout: ReturnType<typeof setTimeout>;

    const cleanup = () => {
	  clearTimeout(timeout);

	  video.onloadedmetadata = null;
	  video.onloadeddata = null;
	  video.onseeked = null;
	  video.onerror = null;

	  video.pause();
	  video.removeAttribute('src');
	  video.load();

	  URL.revokeObjectURL(url);
	};

	const fail = (message: string) => {
	  if (finished) return;

	  finished = true;
	  console.warn('[Gallery]', message);

	  cleanup();
	  reject(new Error(message));
	};

	const succeed = (thumbnail: string) => {
	  if (finished) return;

	  finished = true;

	  cleanup();
	  resolve(thumbnail);
	};
	// Maximum 15 seconds for one thumbnail.
	timeout = setTimeout(() => {
	  fail(`Thumbnail timeout: ${file.name}`);
	}, 15000);


const isBadFrame = () => {
  const imageData = context.getImageData(
    0, 0, canvas.width, canvas.height
  );

  const pixels = imageData.data;

  let sum = 0;
  let sumSquared = 0;

  const totalPixels = pixels.length / 4;

  for (let i = 0; i < pixels.length; i += 4) {
    const brightness =
      0.2126 * pixels[i] +
      0.7152 * pixels[i + 1] +
      0.0722 * pixels[i + 2];

    sum += brightness;
    sumSquared += brightness * brightness;
  }

  const mean = sum / totalPixels;

  const variance =
    sumSquared / totalPixels - mean * mean;

  const standardDeviation = Math.sqrt(variance);

  console.log('[Thumbnail] Standard deviation:', standardDeviation);

  return standardDeviation < 8;
};

	const captureFrame = () => {
	  try {
		context.drawImage(
		  video,
		  0,
		  0,
		  canvas.width,
		  canvas.height
		);

		lastThumbnail = canvas.toDataURL('image/jpeg', 0.85);

		const badFrame = isBadFrame();

		console.log(
		  `Thumbnail attempt ${currentAttempt + 1}:`,
		  video.currentTime,
		  badFrame ? 'BLACK/WHITE FRAME' : 'GOOD FRAME'
		);

		if (!badFrame) {
		  succeed(lastThumbnail);
		  return;
		}

		currentAttempt++;

		if (currentAttempt < timestamps.length) {
		  video.currentTime = timestamps[currentAttempt];
		  return;
		}

		succeed(lastThumbnail);

	  } catch (error) {
		fail(`Could not capture thumbnail: ${file.name}`);
	  }
	};
    // Wait until video dimensions are available.
    video.onloadedmetadata = () => {
      const duration = video.duration;

      if (
        !Number.isFinite(duration) ||
        duration <= 0 ||
        !video.videoWidth ||
        !video.videoHeight
      ) {
        fail(`Invalid video metadata: ${file.name}`);
        return;
      }

      // Create a correctly sized canvas.
      const scale = Math.min(
        1,
        640 / video.videoWidth,
        640 / video.videoHeight
      );

      canvas.width = Math.max(
        1,
        Math.round(video.videoWidth * scale)
      );

      canvas.height = Math.max(
        1,
        Math.round(video.videoHeight * scale)
      );

	if (duration > 600) {
	  // Long videos: start at 1 minute.
	  timestamps = [60, 90];
	} else {
	  // Short videos: start near the beginning.
	  timestamps = [
		Math.min(1, duration * 0.5),
		duration * 0.05,
		Math.min(60, duration * 0.5),
	  ];
	}

	// Remove duplicates and invalid timestamps.
	timestamps = [...new Set(timestamps)].filter(
	  (time) => time >= 0 && time < duration
	);

	timestamps = [...new Set(timestamps)].filter(
	  (time) => time >= 0 && time < duration
	);

      // Remove duplicates and invalid timestamps.
      timestamps = [...new Set(timestamps)].filter(
        (time) => time >= 0 && time < duration
      );

      currentAttempt = 0;

      video.currentTime = timestamps[0];
    };

    video.onseeked = () => {
      captureFrame();
    };

    video.onerror = () => {
      fail(`Could not load video: ${file.name}`);
    };

    video.src = url;
    video.load();
  });


  /*
   * ---------------------------------------------------------
   * SELECT VIDEO FROM GALLERY
   * ---------------------------------------------------------
   */

  const selectGalleryVideo = (
    file: File,
    openDebug = false,
  ) => {
    const url = galleryUrls[file.name];

    if (!url) {
      console.warn('No gallery URL found for:', file.name);
      return;
    }

    console.log('Selecting gallery video:', file.name);

	  setVideoSource('gallery');
	  loadVideo(url);

    if (openDebug) {
      flushSync(() => {
        setDebug(true);
      });
    }
  };

  /*
   * ---------------------------------------------------------
   * FULLSCREEN
   * ---------------------------------------------------------
   */

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await viewerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  };

  /*
   * ---------------------------------------------------------
   * DEBUG VIEWER
   * ---------------------------------------------------------
   */

  const handlePreview = () => {
    if (debug) {
      void closeViewer();
      return;
    }

    if (videoRef.current) {
      videoRef.current.pause();
    }

    flushSync(() => {
      setDebug(true);
    });

    requestAnimationFrame(() => {
      void viewerRef.current?.requestFullscreen();
    });
  };
  
  const closeVideoHandle = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    // Stop playback immediately.
    video.pause();

    // Release the currently loaded media resource.
    video.removeAttribute('src');
    video.load();

    // A drag/drop video gets its own object URL which is no longer needed.
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }

    // Reset video state.
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

const closeViewer = async () => {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch (error) {
      console.error('Exit fullscreen error:', error);
    }
  }

  if (videoSource === 'gallery') {
    closeVideoHandle();

    setVideoSource(null);

    // Stay on the gallery page.
    setDebug(false);

    return;
  }

  // File and URL videos stay loaded.
  setDebug(false);
};


  const handleSelectFile = () => {
    // Stop and unload the main video.
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute('src');
      videoRef.current.load();
    }

    // Stop and unload all gallery preview videos.
    const preview = galleryPreviewRef.current;

	if (preview) {
	  preview.pause();
	  preview.removeAttribute('src');
	  preview.load();
	}

	hoveredVideoRef.current = null;

    // Release all gallery object URLs.
    Object.values(galleryUrls).forEach((url) => {
      URL.revokeObjectURL(url);
    });

    // Release the currently loaded file URL.
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
      currentObjectUrlRef.current = null;
    }

    // Reset gallery and player state.
    setGalleryFiles([]);
    setGalleryUrls({});
	setGalleryDurations({});
    setGalleryThumbnails({});
    setDebug(false);
    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setVideoUrl('');

    // Give React one frame to close/reset the gallery,
    // then open the native file picker.
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLInputElement>('#file-input')
        ?.click();
    });
  };

  /*
   * ---------------------------------------------------------
   * LOAD VIDEO FOLDER
   * ---------------------------------------------------------
   */



const chooseVideoFolder = () => {
  const input = document.createElement('input');

  input.type = 'file';
  input.multiple = true;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
  input.accept = 'video/*';

  input.onchange = async () => {
    if (!input.files) return;

    const files = Array.from(input.files)
      .filter((file) => file.type.startsWith('video/'))
      .sort((a, b) => a.name.localeCompare(b.name));

    if (files.length === 0) {
      toast.error('No video files found in the selected folder.');
      return;
    }

    // Stop shared preview.
    const preview = galleryPreviewRef.current;

    if (preview) {
      preview.pause();
      preview.removeAttribute('src');
      preview.load();
    }

    hoveredVideoRef.current = null;

    // Release old gallery URLs.
    Object.values(galleryUrls).forEach((url) => {
      URL.revokeObjectURL(url);
    });

    // Create URLs for all files, without delays.
    const urls: Record<string, string> = {};

    for (const file of files) {
      urls[file.name] = URL.createObjectURL(file);
    }

    setGalleryFiles(files);
    setGalleryUrls(urls);

    setGalleryDurations({});
    setGalleryAspectRatios({});
    setGalleryThumbnails({});

    console.log(`[Gallery] Loaded ${files.length} files.`);

    // Process metadata and thumbnails sequentially.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      console.log(
        `[Gallery] Processing ${i + 1}/${files.length}: ${file.name}`
      );

      try {
        const metadata = await getVideoMetadata(file);

        setGalleryDurations((previous) => ({
          ...previous,
          [file.name]: metadata.duration,
        }));

        setGalleryAspectRatios((previous) => ({
          ...previous,
          [file.name]: metadata.aspectRatio,
        }));

        const thumbnail = await createVideoThumbnail(file);

        setGalleryThumbnails((previous) => ({
          ...previous,
          [file.name]: thumbnail,
        }));

        console.log('[Gallery] Thumbnail generated:', file.name);

      } catch (error) {
        console.error('[Gallery] Processing failed:', file.name, error);
      }
    }

    console.log('[Gallery] All thumbnails processed.');
  };

  input.click();
};

  /*
   * ---------------------------------------------------------
   * PLAY / PAUSE
   * ---------------------------------------------------------
   */

  const togglePlay = async () => {
    const video = videoRef.current;

    if (!video) return;

    try {
      if (video.paused) {
        await video.play();
      } else {
        video.pause();
      }
    } catch (error) {
      console.error('Play error:', error);
    }
  };

  /*
   * ---------------------------------------------------------
   * VIEW RESET
   * ---------------------------------------------------------
   */

  const resetView = () => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'r',
      }),
    );
  };

  /*
   * ---------------------------------------------------------
   * FORMAT TIME
   * ---------------------------------------------------------
   */

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) {
      return '00:00';
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes.toString().padStart(2, '0')}:${remainingSeconds
      .toString()
      .padStart(2, '0')}`;
  };

  /*
   * ---------------------------------------------------------
   * VIEWER CONTROLS
   * ---------------------------------------------------------
   */

  const showViewerControls = () => {
    setShowControls(true);

    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }

    controlsTimerRef.current = setTimeout(() => {
      setShowControls(false);
    }, 1500);
  };

  /*
   * ---------------------------------------------------------
   * DROPZONE
   * ---------------------------------------------------------
   */

  const {
    getRootProps,
    getInputProps,
    isDragActive,
  } = useDropzone({
    noClick: true,
    multiple: false,

    accept: {
      'video/*': [],
    },

    onDropAccepted: (acceptedFiles) => {
      const selectedFile = acceptedFiles[0];

      if (!selectedFile) {
        return;
      }

      handleVideoFile(selectedFile);
    },

    onDropRejected: (rejection) => {
      const message = rejection[0]?.errors[0]?.message;

      toast.error(
        message ?? 'The selected file is not a valid video.',
      );
    },
  });

  /*
   * ---------------------------------------------------------
   * VIDEO EVENTS / AUTODETECT
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!ready || !autoDetect) {
      return;
    }

    const video = videoRef.current;

    if (!video) {
      return;
    }

    setDetecting(true);

    void (async () => {
      try {
        const frames = await getImageFrames(video);

        const [detectedLayout, detectedFormat] =
          await worker.recognizeVideo(
            transfer(frames, [
              ...frames.map(
                (frame) => frame.data.buffer,
              ),
            ]),
          );

        console.log('VR detection result:', {
          layout: detectedLayout,
          format: detectedFormat,
        });

        if (detectedLayout) {
          setLayout(detectedLayout);
        }

        if (detectedFormat) {
          setFormat(detectedFormat);
        }
      } catch (error) {
        console.error(
          'Video recognition failed:',
          error,
        );
      } finally {
        setDetecting(false);
      }
    })();
  }, [
    autoDetect,
    ready,
    setDetecting,
    setFormat,
    setLayout,
  ]);

  /*
   * ---------------------------------------------------------
   * DEBUG FULLSCREEN
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (!debug) {
      return;
    }

    if (videoRef.current) {
      videoRef.current.pause();
    }

    requestAnimationFrame(() => {
      void viewerRef.current?.requestFullscreen();
    });
  }, [debug]);

  /*
   * ---------------------------------------------------------
   * CLEAR URL INPUT
   * ---------------------------------------------------------
   */

  useEffect(() => {
    if (ready && urlInputRef.current) {
      urlInputRef.current.value = '';
    }
  }, [ready]);

  /*
   * ---------------------------------------------------------
   * CLEANUP
   * ---------------------------------------------------------
   */

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) {
        clearTimeout(controlsTimerRef.current);
      }

      if (currentObjectUrlRef.current) {
        URL.revokeObjectURL(
          currentObjectUrlRef.current,
        );
      }

      Object.values(galleryUrls).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [galleryUrls]);

  /*
   * ---------------------------------------------------------
   * RENDER
   * ---------------------------------------------------------
   */
   
  


  return (
    <div
      className="h-full flex-1 flex flex-col text-white grid-effect"
      {...getRootProps()}
    >
      <Toaster
        position="bottom-center"
        reverseOrder={false}
      />

	{debug &&
	  videoRef.current &&
	  debugContainerRef.current &&
	  ready && (
		<DebugPlayer
		  container={debugContainerRef.current}
		  video={videoRef.current}
		  layout={layout}
		  flipLayout={flipLayout}
		  format={format}
		  autoPlay={autoPlay}
		  renderBackend={renderBackend}
		/>
	  )}


      {videoRef.current &&
        canvasRef.current &&
        ready &&
        xrSession && (
          <VrPlayer
            xrSession={xrSession}
            video={videoRef.current}
            canvas={canvasRef.current}
            layout={layout}
            flipLayout={flipLayout}
            format={format}
          />
        )}

      <div className="mr-10">
        <UI
          fileInputProps={getInputProps()}
          onSelectFile={handleSelectFile}
          onSelectFolder={() => {chooseVideoFolder();}}
		  renderBackend={renderBackend}
		  onRenderBackendChange={setRenderBackend}
		  showGallerySearch={showGallerySearch}
		  onToggleGallerySearch={toggleGallerySearch}
		  gallerySelected={galleryFiles.length > 0}
        />
      </div>

      {/* GALLERY */}
{galleryFiles.length > 0 && (
  <section className="p-4">
<div id="gallery-preview-host" className="hidden">
	<video
	  ref={galleryPreviewRef}
	  muted
	  playsInline
	  preload="none"
	  className="absolute inset-0 w-full h-full object-cover rounded-t-lg"
	  style={{
		display: 'none',
		pointerEvents: 'none',
	  }}
	/>
</div>
  <div className="mb-4">
  <div className="flex items-center gap-2">

    {showGallerySearch && (
      <>
        <input
          type="search"
          autoFocus
          value={gallerySearch}
          onChange={(event) => setGallerySearch(event.target.value)}
          placeholder="Search videos..."
          aria-label="Search videos"
          className="min-w-0 flex-1 rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-white placeholder-gray-400"
        />

		<select
		  value={gallerySort}
		  onChange={(event) => {
			const sort = event.target.value as typeof gallerySort;

			if (sort === 'random') {
			  setRandomOrder(shuffleFiles(galleryFiles));
			}

			setGallerySort(sort);
		  }}
		  aria-label="Sort videos"
		  className="min-w-0 rounded-lg border border-gray-600 bg-gray-800 px-2 py-2 text-white"
		>
		  <option value="name-asc">Name (A–Z)</option>
		  <option value="name-desc">Name (Z–A)</option>
		  <option value="newest">Newest first</option>
		  <option value="oldest">Oldest first</option>
		  <option value="longest">Longest first</option>
		  <option value="shortest">Shortest first</option>
		  <option value="random">Random</option>
		</select>
      </>
    )}
  </div>

  {showGallerySearch && (
    <p className="mt-2 text-sm text-gray-400" aria-live="polite">
      {visibleGalleryFiles.length} of {galleryFiles.length} videos
    </p>
  )}
</div>


{visibleGalleryFiles.length > 0 ? (
  <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">

    {visibleGalleryFiles.map((file) => (
      <button
        key={file.name}
        type="button"
        className="group overflow-hidden rounded-lg bg-gray-800 text-left hover:bg-gray-700"
        onClick={() => selectGalleryVideo(file)}
        onDoubleClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          selectGalleryVideo(file, true);
        }}
        onMouseEnter={(event) => {
          const card = event.currentTarget.querySelector(
            '.gallery-preview-container'
          ) as HTMLDivElement;

          if (card) {
            handleGalleryMouseEnter(file, card);
          }
        }}
        onMouseLeave={handleGalleryMouseLeave}
      >

        {/* VIDEO PREVIEW AREA */}
        
		<div className="gallery-preview-container relative w-full aspect-video bg-gray-900 overflow-hidden rounded-t-lg">
		  {/* Thumbnail */}
		  {galleryThumbnails[file.name] && (
			<img
			  src={galleryThumbnails[file.name]}
			  alt=""
			  className="gallery-thumbnail absolute inset-0 w-full h-full object-cover "
			/>
		  )}

		  {/* Video preview */}
		  <video
			ref={galleryPreviewRef}
			muted
			playsInline
			disablePictureInPicture
			preload="none"
			className="absolute inset-0 w-full h-full object-cover rounded-t-lg "
			style={{
			  display:
				hoveredVideoRef.current === file.name
				  ? 'block'
				  : 'none',
			}}
		  />

		  {/* Loading text */}
		  {!galleryThumbnails[file.name] && (
			<div className="absolute inset-0 flex items-center justify-center text-gray-400">
			  Loading thumbnail...
			</div>
		  )}
		</div>


        {/* VIDEO NAME */}
        <div className="p-3 text-white truncate">
          {file.name}
        </div>

      </button>
    ))}

  </div>
) : (
  <p className="py-10 text-center text-gray-400">
    No videos match your search.
  </p>
)}

  </section>
)}

      {/* -------------------------------------------------- */}
      {/* MAIN VIDEO */}
      {/* -------------------------------------------------- */}

      <div className="flex-1 overflow-auto py-4">
        <video
          ref={videoRef}
          className={clsx(
            'mx-auto shadow-lg rounded',
            ready ? 'max-h-full max-w-full' : 'hidden',
          )}
          playsInline
          preload="auto"
          controls
          autoPlay={autoPlay}
          loop
          onLoadedMetadata={(event) => {
            const video = event.currentTarget;

            console.log(
              'Video metadata loaded:',
              video.duration,
            );

            setDuration(
              Number.isFinite(video.duration)
                ? video.duration
                : 0,
            );
          }}
          onLoadedData={(event) => {
            const video = event.currentTarget;

            console.log(
              'Video data loaded:',
              video.src,
            );

            setReady(true);

            if (
              Number.isFinite(video.duration)
            ) {
              setDuration(video.duration);
            }
          }}
          onCanPlay={() => {
            console.log('Video can play');
            setReady(true);
          }}
          onError={(event) => {
            const video = event.currentTarget;
            const error = video.error;

            console.error('VIDEO ERROR', {
              src: video.currentSrc || video.src,
              code: error?.code,
              message: error?.message,
              networkState: video.networkState,
              readyState: video.readyState,
            });

            setReady(false);

            let message = 'Video could not be loaded.';

            switch (error?.code) {
              case MediaError.MEDIA_ERR_ABORTED:
                message = 'Video loading was aborted.';
                break;

              case MediaError.MEDIA_ERR_NETWORK:
                message = 'Could not download the video.';
                break;

              case MediaError.MEDIA_ERR_DECODE:
                message =
                  'Downloaded the video but cannot decode its format/codec.';
                break;

              case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
                message =
                  'Does not support this video URL or codec.';
                break;
            }

            toast.error(message);
          }}
          onTimeUpdate={(event) => {
            setCurrentTime(
              event.currentTarget.currentTime,
            );
          }}
          onPlay={() => {
            setPlaying(true);
          }}
          onPause={() => {
            setPlaying(false);
          }}
          onEnded={() => {
            setPlaying(false);
          }}
          crossOrigin="anonymous"
        />

        {/* ------------------------------------------------ */}
        {/* START SCREEN */}
        {/* ------------------------------------------------ */}

        {!ready && (
          <div className="h-full flex flex-col justify-center items-center gap-2">
            <div className="text-center text-xl font-medium">
              <span className="inline-block">
                Just drag and drop a video file
                anywhere to play!
              </span>{' '}
              <span className="inline-block">
                (It never leaves your browser)
              </span>
            </div>

            <div className="flex items-center justify-center gap-4 w-full px-4">
              <hr className="max-w-64 h-0.5 bg-gray-200 border-0 rounded flex-1" />

              or

              <hr className="max-w-64 h-0.5 my-8 bg-gray-200 border-0 rounded flex-1" />
            </div>

            <div className="flex flex-col items-center">
              <label
                htmlFor="url-input"
                className="font-semibold"
              >
                Enter Video URL
              </label>

              <div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();

                    const url = urlInputRef.current?.value.trim();

                    if (!url) {
                      return;
                    }

                    try {
                      const parsedUrl = new URL(url);

                      if (!['http:', 'https:', 'blob:'].includes(parsedUrl.protocol)) {
                        toast.error('Please enter a valid HTTP(S) video URL.');
                        return;
                      }

                      setVideoSource('url');
					  loadVideo(parsedUrl.href);
                    } catch {
                      toast.error('Please enter a valid video URL.');
                    }
                  }}
                >
                  <input
                    type="url"
                    value={urlInput}
                    onChange={(event) => {
                      setUrlInput(event.target.value);
                    }}
                    autoComplete="off"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    ref={urlInputRef}
                    id="url-input"
                    className="w-96 p-2 my-4 bg-gray-800 text-white rounded border border-gray-600"
                    placeholder="https://example.com/video.mp4"
                  />

                  {urlInput.trim() && (
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded"
                    >
                      Open
                    </button>
                  )}
                </form>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* -------------------------------------------------- */}
      {/* DEBUG VIEWER */}
      {/* -------------------------------------------------- */}

      <div
        ref={viewerRef}
        className={clsx(
          'fixed inset-0 z-50 bg-black',
          {
            hidden: !debug,
          },
        )}
        onMouseMove={(event) => {
          const rect =
            event.currentTarget.getBoundingClientRect();

          const bottomZone =
            rect.height * 0.18;

          const topZone = 80;
          const rightZone = 100;

          const isBottomZone =
            event.clientY >=
            rect.bottom - bottomZone;

          const isCloseButtonZone =
            event.clientY <=
              rect.top + topZone &&
            event.clientX >=
              rect.right - rightZone;

          if (
            isBottomZone ||
            isCloseButtonZone
          ) {
            showViewerControls();
          }
        }}
      >
		<canvas
  ref={canvasRef}
  className="w-full h-full"
/>
		<div
		  ref={debugContainerRef}
		  className="absolute inset-0 w-full h-full"
		/>

        {/* DEBUG CONTROLS */}

        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 w-full transition-all duration-300',
            {
              'opacity-100 translate-y-0':
                showControls,

              'opacity-0 translate-y-2 pointer-events-none':
                !showControls,
            },
          )}
        >
          <div className="w-full bg-black/60 backdrop-blur-md px-4 pt-3 pb-4">
            <div className="text-xs text-gray-300 mb-1">
              {format === '360'
                ? '360°'
                : format === '180'
                  ? '180°'
                  : '2D'}{' '}
              ·{' '}
              {layout === 'stereoLeftRight'
                ? 'Side-by-Side'
                : layout ===
                    'stereoTopBottom'
                  ? 'Top / Bottom'
                  : 'Mono'}
            </div>

            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={(event) => {
                const time = Number(
                  event.target.value,
                );

                if (videoRef.current) {
                  videoRef.current.currentTime =
                    time;
                }

                setCurrentTime(time);
              }}
              className="w-full cursor-pointer"
            />

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded"
                onClick={() => {
                  void togglePlay();
                }}
              >
                {playing ? '❚❚' : '▶'}
              </button>

              <span className="text-sm min-w-24">
                {formatTime(currentTime)} /{' '}
                {formatTime(duration)}
              </span>

              <span>🔊</span>

              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={volume}
                onChange={(event) => {
                  const newVolume = Number(
                    event.target.value,
                  );

                  setVolume(newVolume);

                  if (videoRef.current) {
                    videoRef.current.volume =
                      newVolume;
                  }
                }}
                className="w-24 cursor-pointer"
              />

              <div className="flex-1" />

              <button
                type="button"
                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded"
                onClick={resetView}
                title="Reset view (R)"
              >
                ↻
              </button>

              <button
                type="button"
                className="px-3 py-2 bg-white/10 hover:bg-white/20 rounded"
                onClick={() => {
                  void toggleFullscreen();
                }}
                title="Fullscreen (F)"
              >
                ⛶
              </button>
            </div>
          </div>
        </div>

        {/* CLOSE BUTTON */}

        <button
          type="button"
          className={clsx(
            'absolute top-0 right-0 p-3 text-white bg-black/50 hover:bg-black/75 transition-opacity duration-300',
            {
              'opacity-100':
                showControls,

              'opacity-0 pointer-events-none':
                !showControls,
            },
          )}
          onClick={() => {
            void closeViewer();
          }}
          aria-label="Close viewer"
          title="Close viewer"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>

      {/* -------------------------------------------------- */}
      {/* DROPZONE OVERLAY */}
      {/* -------------------------------------------------- */}

      <div
        className={clsx(
          'absolute w-full h-full pointer-events-none flex items-center justify-center',
          {
            hidden: !isDragActive,
          },
        )}
      >
        <div className="absolute w-full h-full bg-black opacity-50 border-8 border-dashed" />

        <div className="w-10 h-10 z-10 animate-bounce">
          <ArrowDownTrayIcon />
        </div>
      </div>
    </div>
  );
}
