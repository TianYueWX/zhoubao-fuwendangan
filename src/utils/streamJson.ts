/* ================================================================
 * src/utils/streamJson.ts
 *
 * Streaming JSON array parser for large files.
 * Parses incrementally from file.stream() to avoid Chrome NotReadableError
 * on Cloudflare Pages when reading large JSON files via file.text().
 * ============================================================== */

export interface StreamJsonOptions {
  /** Called for each parsed item in the array */
  onItem?: (item: unknown) => void;
  /** Called with progress info */
  onProgress?: (parsed: number) => void;
}

/**
 * Stream-parse a JSON array from a File using WHATWG Streams API.
 * Avoids loading entire file into memory (fixes Chrome NotReadableError).
 *
 * @param file - The JSON file to parse (must be an array at root: [{...}, {...}])
 * @param options - Optional callbacks for items and progress
 * @returns Promise resolving to the full parsed array
 */
export async function parseJsonStream(
  file: File,
  options: StreamJsonOptions = {}
): Promise<unknown[]> {
  const { onItem, onProgress } = options;
  const items: unknown[] = [];

  console.log('[parseJsonStream] START', file.name, 'size:', file.size, 'type:', file.type);

  // Use file.stream() for native streaming
  const stream = file.stream();
  const reader = stream.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let arrayStarted = false;
  let itemCount = 0;
  let chunkCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      chunkCount++;
      console.log('[parseJsonStream] CHUNK', chunkCount, 'done:', done, 'value length:', value?.length);
      if (done) break;

      // Decode chunk and append to buffer
      const decoded = decoder.decode(value, { stream: true });
      console.log('[parseJsonStream] DECODED chunk length:', decoded.length);
      buffer += decoded;

      // Process buffer to extract complete JSON objects
      let i = 0;
      while (i < buffer.length) {
        const ch = buffer[i];

        if (escapeNext) {
          escapeNext = false;
          i++;
          continue;
        }

        if (inString) {
          if (ch === '\\') {
            escapeNext = true;
          } else if (ch === '"') {
            inString = false;
          }
          i++;
          continue;
        }

        if (ch === '"') {
          inString = true;
          i++;
          continue;
        }

        if (ch === '[') {
          if (!arrayStarted) {
            arrayStarted = true;
            console.log('[parseJsonStream] ARRAY START detected at buffer pos', i);
            i++;
            continue;
          }
          depth++;
        } else if (ch === ']') {
          depth--;
          if (depth === 0 && arrayStarted) {
            // End of array - parse any remaining
            const remaining = buffer.slice(i + 1);
            buffer = remaining;
            i = 0;
            console.log('[parseJsonStream] ARRAY END, remaining:', remaining.length);
            if (remaining.trim()) {
              try {
                const parsed = JSON.parse(remaining);
                if (Array.isArray(parsed)) {
                  console.log('[parseJsonStream] Parsed remaining array items:', parsed.length);
                  parsed.forEach((item) => {
                    items.push(item);
                    onItem?.(item);
                    itemCount++;
                    onProgress?.(itemCount);
                  });
                }
              } catch (e) {
                console.warn('[parseJsonStream] Failed to parse remaining:', e);
              }
            }
            console.log('[parseJsonStream] COMPLETE, total items:', items.length);
            return items;
          }
        } else if (ch === '{') {
          depth++;
        } else if (ch === '}') {
          depth--;
          if (depth === 0 && arrayStarted) {
            // Complete object found at buffer[0..i]
            const objStr = buffer.slice(0, i + 1);
            buffer = buffer.slice(i + 1);
            i = 0; // Reset since buffer changed

            try {
              const item = JSON.parse(objStr);
              items.push(item);
              onItem?.(item);
              itemCount++;
              onProgress?.(itemCount);
              if (itemCount % 1000 === 0) {
                console.log('[parseJsonStream] PROGRESS items:', itemCount, 'buffer:', buffer.length);
              }
            } catch (e) {
              // If parse failed, it might be incomplete - put back and wait for more data
              console.warn('[parseJsonStream] Failed to parse object, putting back. Error:', e);
              buffer = objStr + buffer;
              i = objStr.length;
              break; // Exit inner loop to read more chunks
            }
            continue; // Continue processing buffer from start
          }
        }
        i++;
      }

      // Prevent buffer from growing too large (shouldn't happen with valid JSON array)
      if (buffer.length > 10 * 1024 * 1024) { // 10MB safety limit
        console.error('[parseJsonStream] BUFFER OVERFLOW, length:', buffer.length);
        throw new Error('Buffer overflow - invalid JSON array format');
      }
    }

    // Stream ended - flush decoder and parse any remaining
    const finalDecoded = decoder.decode();
    console.log('[parseJsonStream] STREAM END, final decoded:', finalDecoded.length);
    buffer += finalDecoded;
    if (buffer.trim()) {
      try {
        const parsed = JSON.parse(buffer);
        if (Array.isArray(parsed)) {
          console.log('[parseJsonStream] Parsed final array items:', parsed.length);
          parsed.forEach((item) => {
            items.push(item);
            onItem?.(item);
            itemCount++;
            onProgress?.(itemCount);
          });
        }
      } catch (e) {
        console.warn('[parseJsonStream] Failed to parse final buffer:', e);
      }
    }

    console.log('[parseJsonStream] FINAL RETURN, total items:', items.length);
    return items;
  } catch (e) {
    console.error('[parseJsonStream] ERROR:', e);
    throw e;
  } finally {
    reader.releaseLock();
  }
}

/**
 * Check if a file should use streaming parser.
 * Use streaming for ALL .json files to bypass Chrome Flatpak/Snap sandbox issues.
 */
export function shouldUseStreaming(file: File): boolean {
  const isJson = file.name.toLowerCase().endsWith('.json');
  console.log('[shouldUseStreaming]', file.name, 'size:', file.size, 'isJson:', isJson, '-> streaming:', isJson);
  return isJson;
}

/**
 * Parse JSON file with streaming-first strategy and fallback.
 * Tries streaming parser first (bypasses sandbox), falls back to file.text().
 */
export async function parseJsonAuto(
  file: File,
  options: StreamJsonOptions = {}
): Promise<unknown[]> {
  console.log('[parseJsonAuto] ENTRY', file.name, 'size:', file.size);
  
  // Try streaming FIRST - works around Chrome sandbox for local files
  if (shouldUseStreaming(file)) {
    console.log('[parseJsonAuto] TRYING STREAMING PARSER FIRST');
    try {
      return await parseJsonStream(file, options);
    } catch (streamErr) {
      console.warn('[parseJsonAuto] Streaming failed, falling back to file.text():', streamErr);
      // Fall through to file.text() fallback
    }
  }

  // Fallback: use file.text() for compatibility
  console.log('[parseJsonAuto] USING file.text() FALLBACK');
  try {
    const text = await file.text();
    console.log('[parseJsonAuto] file.text() OK, length:', text.length);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('JSON root must be an array');
    }
    if (options.onItem) {
      parsed.forEach((item, idx) => {
        options.onItem?.(item);
        options.onProgress?.(idx + 1);
      });
    }
    console.log('[parseJsonAuto] PARSED', parsed.length, 'items via file.text()');
    return parsed;
  } catch (e) {
    console.error('[parseJsonAuto] file.text() FAILED:', e);
    throw e;
  }
}