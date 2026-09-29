'use client';

// Editor-wide services the custom fields need (spec 038D): files picked in
// this session (so the canvas shows them before the next preview-data load)
// and the theme's color schemes.

import { createContext, useContext } from 'react';
import type { StoreFile } from '@/lib/content';

export interface EditorServices {
  registerFile: (file: StoreFile) => void;
  fileUrl: (fileId: string) => string | null;
}

export const EditorServicesContext = createContext<EditorServices>({
  registerFile: () => {},
  fileUrl: () => null,
});

export const useEditorServices = () => useContext(EditorServicesContext);
