import { FilenameParser, FilenameMetadata } from './base-filename-parser';
import { ArexFilenameParser } from './arex-filename-parser';
import { SimpleFilenameParser } from './simple-filename-parser';

export class FilenameParserFactory {
  private parsers: FilenameParser[] = [];

  constructor() {
    // Register available parsers
    this.parsers.push(new ArexFilenameParser());
    this.parsers.push(new SimpleFilenameParser());
  }

  /**
   * Parse filename metadata using the appropriate parser.
   * Tries each parser in order until one can parse the filename.
   * If none can parse it, returns default values.
   */
  parseFilenameMetadata(filename: string): FilenameMetadata {
    for (const parser of this.parsers) {
      if (parser.canParse(filename)) {
        console.log(`📋 Using filename parser: ${parser.name}`);
        return parser.parse(filename);
      }
    }

    console.warn(`⚠️  No suitable parser found for filename: ${filename}`);
    return {
      timestamp: 'N/A',
      phoneNumber: 'N/A',
      callType: 'N/A'
    };
  }

  /**
   * Add a new parser to the factory.
   * Parsers are tried in the order they were added.
   */
  addParser(parser: FilenameParser): void {
    this.parsers.push(parser);
  }

  /**
   * Get all registered parsers.
   */
  getParsers(): FilenameParser[] {
    return [...this.parsers];
  }
}
