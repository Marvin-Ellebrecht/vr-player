import { ArrowDownTrayIcon, XMarkIcon } from '@heroicons/react/24/solid';
import { DebugPlayer } from 'components/DebugPlayer';
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

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
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

  const [videoUrl, setVideoUrl] = useAtom(videoUrlAtom);

  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [showControls, setShowControls] = useState(true);

  const [, xrSession] = useXRSession();
  const setDetecting = useSetAtom(detectingAtom);

  const [galleryFiles, setGalleryFiles] = useState<File[]>([]);
  const [galleryUrls, setGalleryUrls] = useState<Record<string, string>>({});
  const [galleryThumbnails, setGalleryThumbnails] = useState<
    Record<string, string>
  >({});

  /*
   * ---------------------------------------------------------
   * VIDEO LADEN
   * ---------------------------------------------------------
   */

  const loadVideo = (url: string) => {
    const video = videoRef.current;

    if (!video) {
      console.warn('Video element not available yet');
      return;
    }

    console.log('Loading video:', url);

    video.pause();

    setReady(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);

    /*
     * Alte Quelle komplett entfernen.
     */
    video.removeAttribute('src');
    video.load();

    /*
     * Neue Quelle setzen.
     */
    video.src = url;
    video.load();

    /*
     * Wichtig:
     * React-State ebenfalls aktualisieren.
     */
    setVideoUrl(url);
  };

  /*
   * ---------------------------------------------------------
   * DATEI PER DRAG & DROP
   * ---------------------------------------------------------
   */

  const handleVideoFile = (selectedFile: File) => {
    console.log('Selected file:', selectedFile);

    if (!selectedFile.type.startsWith('video/')) {
      toast.error('Please select a video file.');
      return;
    }

    /*
     * Alte Object URL freigeben.
     */
    if (currentObjectUrlRef.current) {
      URL.revokeObjectURL(currentObjectUrlRef.current);
    }

    const objectUrl = URL.createObjectURL(selectedFile);

    currentObjectUrlRef.current = objectUrl;

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

      video.src = url;
      video.muted = true;
      video.preload = 'metadata';
      video.playsInline = true;

      video.onloadedmetadata = () => {
        if (!Number.isFinite(video.duration)) {
          URL.revokeObjectURL(url);
          reject(new Error(`Invalid duration for ${file.name}`));
          return;
        }

        video.currentTime = Math.min(1, video.duration / 2);
      };

      video.onseeked = () => {
        const canvas = document.createElement('canvas');

        canvas.width = 320;
        canvas.height = 180;

        const context = canvas.getContext('2d');

        if (!context) {
          URL.revokeObjectURL(url);
          reject(new Error('Could not create thumbnail canvas'));
          return;
        }

        context.drawImage(
          video,
          0,
          0,
          canvas.width,
          canvas.height,
        );

        URL.revokeObjectURL(url);

        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };

      video.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`Could not load ${file.name}`));
      };
    });

  /*
   * ---------------------------------------------------------
   * GALERIE VIDEO AUSWÄHLEN
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

  const closeViewer = async () => {
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch (error) {
        console.error('Exit fullscreen error:', error);
      }
    }

    if (videoRef.current) {
      videoRef.current.pause();
    }

    setDebug(false);
  };

  /*
   * ---------------------------------------------------------
   * VIDEO ORDNER LADEN
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

      console.log('Gallery files:', files);

      /*
       * Alte Galerie URLs freigeben.
       */
      Object.values(galleryUrls).forEach((url) => {
        URL.revokeObjectURL(url);
      });

      /*
       * Neue URLs erstellen.
       */
      const urls: Record<string, string> = {};

      for (const file of files) {
        urls[file.name] = URL.createObjectURL(file);
      }

      setGalleryFiles(files);
      setGalleryUrls(urls);

      /*
       * Thumbnails erzeugen.
       */
      const thumbnails: Record<string, string> = {};

      for (const file of files) {
        try {
          thumbnails[file.name] =
            await createVideoThumbnail(file);
        } catch (error) {
          console.error(
            `Could not create thumbnail for ${file.name}`,
            error,
          );
        }
      }

      setGalleryThumbnails(thumbnails);

      /*
       * Erstes Video direkt laden.
       *
       * Das kannst du entfernen, wenn beim Ordner auswählen
       * NICHT automatisch das erste Video geladen werden soll.
       */
      if (files.length > 0) {
        const firstUrl = urls[files[0].name];

        if (firstUrl) {
          loadVideo(firstUrl);
        }
      }
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
   * ZEIT FORMATIEREN
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
   * URL INPUT LEEREN
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
        canvasRef.current &&
        ready && (
          <DebugPlayer
            key={videoUrl}
            video={videoRef.current}
            canvas={canvasRef.current}
            layout={layout}
            flipLayout={flipLayout}
            format={format}
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
          onSelectFolder={() => {
            chooseVideoFolder();
          }}
        />
      </div>

      {/* -------------------------------------------------- */}
      {/* GALERIE */}
      {/* -------------------------------------------------- */}

      {galleryFiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 p-4">
          {galleryFiles.map((file) => (
            <button
              key={file.name}
              type="button"
              className="text-left bg-gray-800 hover:bg-gray-700 rounded-lg overflow-hidden"
              onClick={() => {
                selectGalleryVideo(file);
              }}
              onDoubleClick={() => {
                selectGalleryVideo(file, true);
              }}
              onMouseEnter={(event) => {
                const video =
                  event.currentTarget.querySelector(
                    'video',
                  );

                if (video) {
                  video.currentTime = 0;
                  video.muted = true;

                  void video.play().catch(() => {
                    // Browser kann Autoplay blockieren.
                  });
                }
              }}
              onMouseLeave={(event) => {
                const video =
                  event.currentTarget.querySelector(
                    'video',
                  );

                if (video) {
                  video.pause();
                  video.currentTime = 0;
                }
              }}
            >
              {galleryUrls[file.name] ? (
                <video
                  src={galleryUrls[file.name]}
                  poster={
                    galleryThumbnails[file.name]
                  }
                  muted
                  playsInline
                  preload="metadata"
                  controls={false}
                  disablePictureInPicture
                  aria-hidden="true"
                  className="w-full aspect-video object-cover"
                />
              ) : (
                <div className="w-full aspect-video bg-gray-900 flex items-center justify-center">
                  Loading...
                </div>
              )}

              <div className="p-2 text-sm text-white truncate">
                {file.name}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* -------------------------------------------------- */}
      {/* HAUPTVIDEO */}
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

            console.error(
              'VIDEO ERROR:',
              video.error,
              video.src,
            );

            setReady(false);

            toast.error(
              'Video could not be loaded.',
            );
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
        {/* STARTSCREEN */}
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
                <input
                  type="url"
                  autoComplete="off"
                  spellCheck="false"
                  autoCorrect="off"
                  autoCapitalize="off"
                  ref={urlInputRef}
                  id="url-input"
                  className="w-96 p-2 my-4 bg-gray-800 text-white rounded border border-gray-600"
                  placeholder="https://example.com/video.mp4"
                  onChange={(event) => {
                    const url =
                      event.target.value.trim();

                    if (url) {
                      loadVideo(url);
                    }
                  }}
                />
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
