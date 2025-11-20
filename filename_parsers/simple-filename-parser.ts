import { FilenameParser, FilenameMetadata } from './base-filename-parser';

export class SimpleFilenameParser implements FilenameParser {
  name = 'simple';

  canParse(filename: string): boolean {
    // Check for the simple pattern: "<phone> YYYY-MM-DD HH-MM-SS"
    const baseName = filename.replace(/\.[^.]+$/, '');
    const simplePattern = baseName.match(/^([+]?[\d\s-]+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})$/);
    return simplePattern !== null;
  }

  parse(filename: string): FilenameMetadata {
    // Default values
    let timestamp = 'N/A';
    let phoneNumber = 'N/A';
    let callType = 'N/A'; // This format doesn't include call type

    try {
      const baseName = filename.replace(/\.[^.]+$/, '');

      // Handle new "<phone> YYYY-MM-DD HH-MM-SS" pattern
      const simplePattern = baseName.match(/^([+]?[\d\s-]+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})$/);
      if (simplePattern) {
        const rawPhone = simplePattern[1].replace(/[^+\d]/g, '');
        const normalizedPhone = rawPhone.startsWith('+') ? rawPhone.slice(1) : rawPhone;
        phoneNumber = normalizedPhone || 'N/A';
        timestamp = `${simplePattern[2]} ${simplePattern[3]}:${simplePattern[4]}:${simplePattern[5]}`;
        return { timestamp, phoneNumber, callType };
      }
    } catch (error) {
      console.warn(`⚠️  Could not parse metadata from filename with simple parser: ${filename}`);
    }

    return { timestamp, phoneNumber, callType };
  }
}
