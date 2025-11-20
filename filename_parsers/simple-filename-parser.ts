import { FilenameParser, FilenameMetadata } from './base-filename-parser';

export class SimpleFilenameParser implements FilenameParser {
  name = 'simple';

  canParse(filename: string): boolean {
    const baseName = filename.replace(/\.[^.]+$/, '');

    // Check for space-separated format: "<phone> YYYY-MM-DD HH-MM-SS"
    const spaceSeparatedPattern = baseName.match(/^([+]?[\d\s-]+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})$/);

    // Check for compact format: "+918328633433-2511071507"
    const compactPattern = baseName.match(/^([+]?[\d]+)-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);

    return spaceSeparatedPattern !== null || compactPattern !== null;
  }

  parse(filename: string): FilenameMetadata {
    // Default values
    let timestamp = 'N/A';
    let phoneNumber = 'N/A';
    let callType = 'N/A'; // This format doesn't include call type

    try {
      const baseName = filename.replace(/\.[^.]+$/, '');

      // First try the space-separated format: "<phone> YYYY-MM-DD HH-MM-SS"
      const spaceSeparatedPattern = baseName.match(/^([+]?[\d\s-]+?)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2})-(\d{2})-(\d{2})$/);
      if (spaceSeparatedPattern) {
        const rawPhone = spaceSeparatedPattern[1].replace(/[^+\d]/g, '');
        const normalizedPhone = rawPhone.startsWith('+') ? rawPhone.slice(1) : rawPhone;
        phoneNumber = normalizedPhone || 'N/A';
        timestamp = `${spaceSeparatedPattern[2]} ${spaceSeparatedPattern[3]}:${spaceSeparatedPattern[4]}:${spaceSeparatedPattern[5]}`;
        return { timestamp, phoneNumber, callType };
      }

      // Then try the compact format: "+918328633433-2511071507" -> YYMMDDHHMM
      const compactPattern = baseName.match(/^([+]?[\d]+)-(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);
      if (compactPattern) {
        const rawPhone = compactPattern[1];
        const normalizedPhone = rawPhone.startsWith('+') ? rawPhone.slice(1) : rawPhone;
        phoneNumber = normalizedPhone || 'N/A';

        // Parse YYMMDDHHMM format
        const year = '20' + compactPattern[2]; // Add 20XX century
        const month = compactPattern[3];
        const day = compactPattern[4];
        const hour = compactPattern[5];
        const minute = compactPattern[6];
        timestamp = `${year}-${month}-${day} ${hour}:${minute}:00`;

        return { timestamp, phoneNumber, callType };
      }
    } catch (error) {
      console.warn(`⚠️  Could not parse metadata from filename with simple parser: ${filename}`);
    }

    return { timestamp, phoneNumber, callType };
  }
}
