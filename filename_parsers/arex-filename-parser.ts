import { FilenameParser, FilenameMetadata } from './base-filename-parser';

export class ArexFilenameParser implements FilenameParser {
  name = 'arex';

  canParse(filename: string): boolean {
    // Check for TP tokens pattern
    return filename.includes('TP1') || filename.includes('TP3') || filename.includes('TP4');
  }

  parse(filename: string): FilenameMetadata {
    // Default values
    let timestamp = 'N/A';
    let phoneNumber = 'N/A';
    let callType = 'N/A';

    try {
      const baseName = filename.replace(/\.[^.]+$/, '');

      // Extract TP tokens from filename
      const tp1Match = filename.match(/TP1(\d+)/);
      const tp3Match = filename.match(/TP3([+\d]+)/);
      const tp4Match = filename.match(/TP4(\w+)/);

      // Parse timestamp (TP1) - assuming it's a Unix timestamp in milliseconds
      if (tp1Match) {
        const ts = parseInt(tp1Match[1]);
        if (!isNaN(ts)) {
          // Convert Unix timestamp to readable format
          const date = new Date(ts);
          timestamp = date.toISOString().slice(0, 19).replace('T', ' ');
        }
      }

      // Parse phone number (TP3) - handle numbers with + prefix
      if (tp3Match) {
        const phoneStr = tp3Match[1];
        // Remove + prefix if present and extract the actual number
        phoneNumber = phoneStr.startsWith('+') ? phoneStr.substring(1) : phoneStr;
      }

      // Parse call type (TP4) - extract only the word after TP4 until next TP
      if (tp4Match) {
        const afterTP4 = filename.substring(filename.indexOf('TP4') + 3);
        const nextTPMatch = afterTP4.match(/TP\d/);
        if (nextTPMatch) {
          callType = afterTP4.substring(0, nextTPMatch.index).trim();
        } else {
          callType = afterTP4.trim();
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not parse metadata from filename with arex parser: ${filename}`);
    }

    return { timestamp, phoneNumber, callType };
  }
}
