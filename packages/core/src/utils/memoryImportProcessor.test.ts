/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { processImports, validateImportPath, getAllowedImportDirectories } from './memoryImportProcessor.js';

// Mock fs/promises
vi.mock('fs/promises');
const mockedFs = vi.mocked(fs);

// Mock console methods to capture warnings
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;
const originalConsoleDebug = console.debug;

describe('memoryImportProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock console methods
    console.warn = vi.fn();
    console.error = vi.fn();
    console.debug = vi.fn();
  });

  afterEach(() => {
    // Restore console methods
    console.warn = originalConsoleWarn;
    console.error = originalConsoleError;
    console.debug = originalConsoleDebug;
  });

  describe('processImports', () => {
    it('should process basic md file imports', async () => {
      const content = 'Some content @./test.md more content';
      const basePath = '/test/path';
      const importedContent = '# Imported Content\nThis is imported.';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile.mockResolvedValue(importedContent);

      const result = await processImports(content, basePath, true);

      expect(result).toContain('<!-- Imported from: ./test.md -->');
      expect(result).toContain(importedContent);
      expect(result).toContain('<!-- End of import from: ./test.md -->');
      expect(mockedFs.readFile).toHaveBeenCalledWith(
        path.resolve(basePath, './test.md'),
        'utf-8',
      );
    });

    it('should warn and fail for non-md file imports', async () => {
      const content = 'Some content @./instructions.txt more content';
      const basePath = '/test/path';

      const result = await processImports(content, basePath, true);

      expect(console.warn).toHaveBeenCalledWith(
        '[WARN] [ImportProcessor]',
        'Import processor only supports .md files. Attempting to import non-md file: ./instructions.txt. This will fail.',
      );
      expect(result).toContain(
        '<!-- Import failed: ./instructions.txt - Only .md files are supported -->',
      );
      expect(mockedFs.readFile).not.toHaveBeenCalled();
    });

    it('should handle circular imports', async () => {
      const content = 'Content @./circular.md more content';
      const basePath = '/test/path';
      const circularContent = 'Circular @./main.md content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile.mockResolvedValue(circularContent);

      // Set up the import state to simulate we're already processing main.md
      const importState = {
        processedFiles: new Set<string>(),
        maxDepth: 10,
        currentDepth: 0,
        currentFile: '/test/path/main.md', // Simulate we're processing main.md
      };

      const result = await processImports(content, basePath, true, importState);

      // The circular import should be detected when processing the nested import
      expect(result).toContain('<!-- Circular import detected: ./main.md -->');
    });

    it('should handle file not found errors', async () => {
      const content = 'Content @./nonexistent.md more content';
      const basePath = '/test/path';

      mockedFs.access.mockRejectedValue(new Error('File not found'));

      const result = await processImports(content, basePath, true);

      expect(result).toContain(
        '<!-- Import failed: ./nonexistent.md - File not found -->',
      );
      expect(console.error).toHaveBeenCalledWith(
        '[ERROR] [ImportProcessor]',
        'Failed to import ./nonexistent.md: File not found',
      );
    });

    it('should respect max depth limit', async () => {
      const content = 'Content @./deep.md more content';
      const basePath = '/test/path';
      const deepContent = 'Deep @./deeper.md content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile.mockResolvedValue(deepContent);

      const importState = {
        processedFiles: new Set<string>(),
        maxDepth: 1,
        currentDepth: 1,
      };

      const result = await processImports(content, basePath, true, importState);

      expect(console.warn).toHaveBeenCalledWith(
        '[WARN] [ImportProcessor]',
        'Maximum import depth (1) reached. Stopping import processing.',
      );
      expect(result).toBe(content);
    });

    it('should handle nested imports recursively', async () => {
      const content = 'Main @./nested.md content';
      const basePath = '/test/path';
      const nestedContent = 'Nested @./inner.md content';
      const innerContent = 'Inner content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile
        .mockResolvedValueOnce(nestedContent)
        .mockResolvedValueOnce(innerContent);

      const result = await processImports(content, basePath, true);

      expect(result).toContain('<!-- Imported from: ./nested.md -->');
      expect(result).toContain('<!-- Imported from: ./inner.md -->');
      expect(result).toContain(innerContent);
    });

    it('should handle absolute paths in imports', async () => {
      const content = 'Content @/absolute/path/file.md more content';
      const basePath = '/test/path';
      const importedContent = 'Absolute path content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile.mockResolvedValue(importedContent);

      const result = await processImports(content, basePath, true);

      expect(result).toContain(
        '<!-- Import failed: /absolute/path/file.md - Absolute paths not allowed -->',
      );
    });

    it('should handle multiple imports in same content', async () => {
      const content = 'Start @./first.md middle @./second.md end';
      const basePath = '/test/path';
      const firstContent = 'First content';
      const secondContent = 'Second content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile
        .mockResolvedValueOnce(firstContent)
        .mockResolvedValueOnce(secondContent);

      const result = await processImports(content, basePath, true);

      expect(result).toContain('<!-- Imported from: ./first.md -->');
      expect(result).toContain('<!-- Imported from: ./second.md -->');
      expect(result).toContain(firstContent);
      expect(result).toContain(secondContent);
    });

    it('should handle parent directory imports', async () => {
      const content = 'Content @../parent.md more content';
      const basePath = '/test/path/subdir';
      const parentContent = 'Parent directory content';

      mockedFs.access.mockResolvedValue(undefined);
      mockedFs.readFile.mockResolvedValue(parentContent);

      const result = await processImports(content, basePath, true);

      expect(result).toContain('<!-- Imported from: ../parent.md -->');
      expect(result).toContain(parentContent);
      expect(result).toContain('<!-- End of import from: ../parent.md -->');
      expect(mockedFs.readFile).toHaveBeenCalledWith(
        path.resolve(basePath, '../parent.md'),
        'utf-8',
      );
    });
  });

  describe('validateImportPath', () => {
    it('should reject URLs', () => {
      expect(
        validateImportPath('https://example.com/file.md', '/base', [
          '/allowed',
        ]),
      ).toBe(false);
      expect(
        validateImportPath('http://example.com/file.md', '/base', ['/allowed']),
      ).toBe(false);
      expect(
        validateImportPath('file:///path/to/file.md', '/base', ['/allowed']),
      ).toBe(false);
    });

    it('should allow paths within allowed directories', () => {
      expect(validateImportPath('./file.md', '/base', ['/base'])).toBe(true);
      expect(validateImportPath('../file.md', '/base', ['/allowed'])).toBe(
        false,
      );
      expect(validateImportPath('../file.md', '/base', ['/base', '/'])).toBe(
        true,
      );
      expect(
        validateImportPath('/allowed/sub/file.md', '/base', ['/allowed']),
      ).toBe(true);
    });

    it('should reject paths outside allowed directories', () => {
      expect(
        validateImportPath('/forbidden/file.md', '/base', ['/allowed']),
      ).toBe(false);
      expect(validateImportPath('../../../file.md', '/base', ['/base'])).toBe(
        false,
      );
    });

    it('should handle multiple allowed directories', () => {
      expect(
        validateImportPath('./file.md', '/base', ['/allowed1', '/allowed2']),
      ).toBe(false);
      expect(
        validateImportPath('/allowed1/file.md', '/base', [
          '/allowed1',
          '/allowed2',
        ]),
      ).toBe(true);
      expect(
        validateImportPath('/allowed2/file.md', '/base', [
          '/allowed1',
          '/allowed2',
        ]),
      ).toBe(true);
    });

    it('should handle relative paths correctly', () => {
      expect(validateImportPath('file.md', '/base', ['/base'])).toBe(true);
      expect(validateImportPath('./file.md', '/base', ['/base'])).toBe(true);
      expect(validateImportPath('../file.md', '/base', ['/parent'])).toBe(
        false,
      );
    });

    it('should handle absolute paths correctly', () => {
      expect(
        validateImportPath('/allowed/file.md', '/base', ['/allowed']),
      ).toBe(true);
      expect(
        validateImportPath('/forbidden/file.md', '/base', ['/allowed']),
      ).toBe(false);
    });
  });

  describe('getAllowedImportDirectories', () => {
    it('should include the base directory', () => {
      const basePath = '/test/path/subdir';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).toContain(basePath);
    });

    it('should include all parent directories up to filesystem root', () => {
      const basePath = '/a/b/c/d';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).toEqual([
        '/a/b/c/d',  // current
        '/a/b/c',    // 1 level up
        '/a/b',      // 2 levels up
        '/a',        // 3 levels up
      ]);
    });

    it('should stop before filesystem root', () => {
      const basePath = '/a';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).toEqual(['/a']);
    });

    it('should handle deep paths correctly', () => {
      const basePath = '/very/deep/nested/path/with/many/levels';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).toHaveLength(7); // current + all levels up to root
      expect(allowedDirs[0]).toBe(basePath);
      expect(allowedDirs[1]).toBe('/very/deep/nested/path/with/many');
      expect(allowedDirs[2]).toBe('/very/deep/nested/path/with');
      expect(allowedDirs[3]).toBe('/very/deep/nested/path');
      expect(allowedDirs[4]).toBe('/very/deep/nested');
      expect(allowedDirs[5]).toBe('/very/deep');
      expect(allowedDirs[6]).toBe('/very');
    });

    it('should not include filesystem root in allowed directories', () => {
      const basePath = '/a/b';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).not.toContain('/');
      expect(allowedDirs).toEqual(['/a/b', '/a']);
    });

    it('should handle paths very close to filesystem root', () => {
      const basePath = '/projects/myproject';
      const allowedDirs = getAllowedImportDirectories(basePath);
      
      expect(allowedDirs).toEqual([
        '/projects/myproject',  // current
        '/projects',            // 1 level up
      ]);
      expect(allowedDirs).not.toContain('/');
    });
  });
});
