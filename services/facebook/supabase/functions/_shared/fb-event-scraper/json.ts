// deno-lint-ignore-file no-explicit-any

export interface JsonSearchResult {
    startIndex: number;
    endIndex: number;
    jsonData: any;
}

/**
 * Find the JSON value stored under `"key":` in a page's inline scripts.
 *
 * Facebook ships event data as minified JSON inside script tags, so this
 * scans the raw HTML for the key and brace-matches the value that follows.
 *
 * Without `isDesiredValue`, the first occurrence wins, null included.
 *
 * With `isDesiredValue`, it keeps scanning until an object or array satisfies
 * it. Null and other non-object values can't match, so they're skipped:
 * unrelated modules in Facebook's page shell reuse generic keys such as
 * `"data":null`, and stopping there hid the real event data (Nov 2026).
 * If nothing matches but a null was seen, that null is returned, so callers
 * can still tell "present but empty" (startIndex >= 0) from "missing" (-1).
 */
export const findJsonInString = (
    dataString: string,
    key: string,
    isDesiredValue?: (value: Record<string, any>) => boolean,
): JsonSearchResult => {
    const prefix = `"${key}":`;

    let startPosition = 0;
    let firstNull: JsonSearchResult | null = null;

    // This loop is used for iterating over found json objects, and checking if they are the one we want using the isDesiredValue callback
    while (true) {
        let idx = dataString.indexOf(prefix, startPosition);
        if (idx === -1) {
            return firstNull ?? { startIndex: -1, endIndex: -1, jsonData: null };
        }

        idx += prefix.length;
        const startIndex = idx;

        const startCharacter = dataString[startIndex];

        // Value is null
        if (startCharacter === 'n' && dataString.slice(startIndex, startIndex + 4) === 'null') {
            const nullResult = { startIndex, endIndex: startIndex + 3, jsonData: null };
            if (!isDesiredValue) {
                return nullResult;
            }
            firstNull ??= nullResult;
            startPosition = startIndex;
            continue;
        }

        // Unexpected start character
        if (startCharacter !== '{' && startCharacter !== '[') {
            if (!isDesiredValue) {
                throw new Error(`Invalid start character: ${startCharacter}`);
            }
            startPosition = startIndex;
            continue;
        }

        const endCharacter = startCharacter === '{' ? '}' : ']';

        let nestedLevel = 0;
        // This is set to true anytime idx is pointing to a string value. In these cases, we want to ignore any start or end characters we find
        let isIndexInString = false;

        // This loop iterates over each character in the json object until we get to the end of the object
        while (idx < dataString.length - 1) {
            // In the first iteration, idx is pointing to the first "{" or "[", so we start by incrementing it
            idx++;

            if (dataString[idx] === '"' && dataString[idx - 1] !== '\\') {
                isIndexInString = !isIndexInString;
            } else if (dataString[idx] === endCharacter && !isIndexInString) {
                if (nestedLevel === 0) {
                    break;
                }
                nestedLevel--;
            } else if (dataString[idx] === startCharacter && !isIndexInString) {
                nestedLevel++;
            }
        }

        const jsonDataString = dataString.slice(startIndex, idx + 1);
        const jsonData = JSON.parse(jsonDataString);

        if (!isDesiredValue || isDesiredValue(jsonData)) {
            return { startIndex, endIndex: idx, jsonData };
        }

        startPosition = idx;
    }
};
