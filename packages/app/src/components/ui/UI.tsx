import { Control } from './Control';
import { GroupControl } from './GroupControl';
import { GroupControlElement } from './GroupControlElement';
import {
  autoDetectAtom,
  autoPlayAtom,
  debugAtom,
  detectingAtom,
  flipLayoutAtom,
  formatAtom,
  layoutAtom,
} from 'atoms/controls';
import { useAtom, useAtomValue } from 'jotai';
import { useXRSession } from 'hooks/useXRSession';
import clsx from 'clsx';
import type { DropzoneInputProps } from 'react-dropzone';
import type { RenderBackend } from '@vr-player/player';
import { useState } from 'react';


export function UI({
  fileInputProps,
  onSelectFile,
  onSelectFolder,
  renderBackend,
  onRenderBackendChange,
  showGallerySearch,
  onToggleGallerySearch,
  gallerySelected,
}: {
  fileInputProps: DropzoneInputProps;
  onSelectFile: () => void;
  onSelectFolder: () => void;
  renderBackend: RenderBackend;
  onRenderBackendChange: (backend: RenderBackend) => void;
  showGallerySearch: boolean;
  onToggleGallerySearch: () => void;
  gallerySelected: boolean;
}) {


  const [autoPlay, setAutoPlay] = useAtom(autoPlayAtom);
  const [autoDetect, setAutoDetect] = useAtom(autoDetectAtom);

  const detecting = useAtomValue(detectingAtom);

  const [layout, setLayout] = useAtom(layoutAtom);
  const [flipLayout, setFlipLayout] = useAtom(flipLayoutAtom);
  const [format, setFormat] = useAtom(formatAtom);

  const [debug, setDebug] = useAtom(debugAtom);

  const [xrSupported, xrSession, requestXrSession] = useXRSession();
  const webGpuSupported = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const [showVideoSettings, setShowVideoSettings] = useState(false);

  return (
    <div
      data-nosnippet
      className="flex flex-wrap items-start whitespace-nowrap"
    >
      <Control
        aria-current={Boolean(xrSession)}
        disabled={!xrSupported}
        onClick={() => {
          if (xrSession) {
            void xrSession.end();
          } else {
            requestXrSession();
          }
        }}
      >
        {
          // eslint-disable-next-line no-nested-ternary
          xrSupported
            ? xrSession
              ? 'Exit VR'
              : 'Enter VR'
            : 'VR Not Supported'
        }
      </Control>

		<button
		  type="button"
		  className="cursor-pointer flex m-2 py-2 px-4 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg shadow-sm"
		  onClick={onSelectFile}
		>
		  Select File
		</button>

		<input
		  id="file-input"
		  {...fileInputProps}
		  className="hidden"
		/>


      <button
  type="button"
  className="cursor-pointer flex m-2 py-2 px-4 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg shadow-sm"
  onClick={onSelectFolder}
>
  Select Folder
</button>
	  

      
	  


      <div className="flex items-center">
  {detecting && (
    <span
      className="absolute ml-2 h-3 w-3"
      role="status"
    >
      <span className="sr-only">Loading...</span>
      <span className="absolute h-full w-full rounded-full bg-white shadow-sm" />
      <span className="absolute h-full w-full animate-ping rounded-full bg-white" />
    </span>
  )}

  <div className="flex items-stretch m-2">
    <div className="[&>button]:!m-0 [&>button]:rounded-r-none">
      <Control
        aria-current={autoDetect}
        onClick={() => setAutoDetect(!autoDetect)}
      >
        Detect Video Settings
      </Control>
    </div>

    <button
      type="button"
      aria-label={
        showVideoSettings
          ? 'Collapse video settings'
          : 'Expand video settings'
      }
      aria-expanded={showVideoSettings}
      onClick={() =>
        setShowVideoSettings((previous) => !previous)
      }
      className="rounded-r-lg border border-l-0 border-gray-600 bg-gray-700 px-3 text-sm font-bold text-white hover:bg-gray-600"
    >
      {showVideoSettings ? '<' : '>'}
    </button>
  </div>
</div>

{showVideoSettings && (
  <div className="flex flex-wrap items-center rounded-md gap-0 m-0 p-0">       
	
	{<Control aria-current={autoPlay} onClick={() => setAutoPlay(!autoPlay)}>
        Autoplay
	</Control>}
	
	
	{<GroupControl className="my-0">
        <GroupControlElement
          aria-current={layout === 'mono'}
          onClick={() => setLayout('mono')}
        >
          Mono
        </GroupControlElement>
        <GroupControlElement
          aria-current={layout === 'stereoLeftRight'}
          onClick={() => setLayout('stereoLeftRight')}
        >
          Left | Right
        </GroupControlElement>
        <GroupControlElement
          aria-current={layout === 'stereoTopBottom'}
          onClick={() => setLayout('stereoTopBottom')}
        >
          Top | Bottom
        </GroupControlElement>
        <GroupControlElement
          aria-current={flipLayout && layout !== 'mono'}
          disabled={layout === 'mono'}
          onClick={() => setFlipLayout(!flipLayout)}
        >
          Flip
        </GroupControlElement>
      </GroupControl>}
    {<GroupControl className="my-0">
  <GroupControlElement
    aria-current={format === 'screen'}
    onClick={() => setFormat('screen')}
  >
    Screen
  </GroupControlElement>

  <GroupControlElement
    aria-current={format === '180'}
    onClick={() => setFormat('180')}
  >
    180°
  </GroupControlElement>

  <GroupControlElement
    aria-current={format === '360'}
    onClick={() => setFormat('360')}
  >
    360°
  </GroupControlElement>

  <GroupControlElement
    aria-current={format === 'fisheye'}
    onClick={() => setFormat('fisheye')}
  >
    Fisheye
  </GroupControlElement>
</GroupControl>}

    {<div className="flex items-center m-2 my-0">
  <label
    htmlFor="render-backend"
    className="mr-2 text-sm text-gray-300"
  >
    Renderer
  </label>

  <select
    id="render-backend"
    value={renderBackend}
    onChange={(event) => {
      onRenderBackendChange(
        event.target.value as RenderBackend,
      );
    }}
    className="cursor-pointer rounded-lg border border-gray-600 bg-gray-700 px-3 py-2 text-sm font-medium text-white hover:bg-gray-600"
  >

    <option value="webgl1">
      WebGL
    </option>



    <option
      value="webgpu"
      disabled={!webGpuSupported}
    >
      WebGPU
      {!webGpuSupported
        ? ' (not supported)'
        : ''}
    </option>
  </select>
</div>}
  </div>
)}









{gallerySelected && (
  <button
    type="button"
    aria-label={
      showGallerySearch ? 'Close gallery search' : 'Open gallery search'
    }
    aria-expanded={showGallerySearch}
    onClick={onToggleGallerySearch}
    className="cursor-pointer flex m-2 py-2 px-4 text-sm font-medium text-white bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg shadow-sm"
  >
    {showGallerySearch ? '✕' : '⌕'}
  </button>
)}


<Control
  aria-current={debug}
  onClick={() => setDebug(!debug)}
>
  Watch Video
</Control>



      
    </div>
  );
}
