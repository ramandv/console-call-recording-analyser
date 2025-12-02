import { FilenameParser, FilenameMetadata } from './base-filename-parser';

export class CallRecordingFilenameParser implements FilenameParser {
  name = 'call-recording';

  canParse(filename: string): boolean {
    // Check if starts with "Call recording "
    return filename.startsWith('Call recording ');
  }

  parse(filename: string): FilenameMetadata {
    // Default values
    let timestamp = 'N/A';
    let phoneNumber = 'N/A';
    let callType = 'N/A'; // This format doesn't specify call type

    try {
      // Remove extension and "Call recording " prefix
      const baseName = filename.replace(/\.[^.]+$/, '').replace(/^Call recording\s+/, '');

      // Split by underscore
      const parts = baseName.split('_');
      if (parts.length >= 3) {
        const phoneStr = parts[0];
        const dateStr = parts[1]; // YYMMDD
        const timeStr = parts[2]; // HHMMSS

        // Normalize phone number
        phoneNumber = phoneStr.startsWith('+') ? phoneStr.substring(1) : phoneStr;

        // Parse date: YYMMDD to YYYY-MM-DD
        if (dateStr.length === 6) {
          const year = '20' + dateStr.slice(0, 2);
          const month = dateStr.slice(2, 4);
          const day = dateStr.slice(4, 6);
          // Parse time: HHMMSS to HH:MM:SS
          if (timeStr.length === 6) {
            const hour = timeStr.slice(0, 2);
            const minute = timeStr.slice(2, 4);
            const second = timeStr.slice(4, 6);
            timestamp = `${year}-${month}-${day} ${hour}:${minute}:${second}`;
          }
        }
      }
    } catch (error) {
      console.warn(`⚠️  Could not parse metadata from filename with call-recording parser: ${filename}`);
    }

    return { timestamp, phoneNumber, callType };
  }
}
