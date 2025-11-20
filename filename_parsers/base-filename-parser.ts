export interface FilenameMetadata {
  timestamp: string;
  phoneNumber: string;
  callType: string;
}

export interface FilenameParser {
  name: string;
  canParse(filename: string): boolean;
  parse(filename: string): FilenameMetadata;
}
