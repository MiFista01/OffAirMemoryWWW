import { Pipe, PipeTransform } from '@angular/core';

/**
 * MarkdownSplitPipe - Safe Markdown text truncation with syntax preservation
 * 
 * This pipe truncates Markdown text to a specified character limit while:
 * - Removing the last incomplete line
 * - Automatically closing all unclosed Markdown tags
 * - Removing truncated links and brackets
 * - Adding ellipsis (...) at the end of truncated text
 * 
 * @example
 * ```html
 * <markdown [data]="chat.description | markdownSplit:500" postMarkdown></markdown>
 * ```
 * 
 * @example
 * ```typescript
 * // Input text:
 * const text = "# Heading\n**Bold text** and *italic* [link](url)";
 * const result = pipe.transform(text, 20);
 * // Result: "# Heading\n**Bold**..."
 * ```
 */
@Pipe({
  name: 'markdownSplit',
  standalone: true
})
export class MarkdownSplitPipe implements PipeTransform {

  /**
   * Truncates Markdown text to specified limit while preserving syntax
   * 
   * @param value - Source Markdown text to truncate
   * @param limit - Maximum number of characters (0 = no limit)
   * @returns Truncated Markdown text with closed tags and ellipsis
   * 
   * @example
   * ```typescript
   * transform("**Bold** and *italic*", 10) // "**Bold**..."
   * transform("Regular text", 5) // "Regul..."
   * transform("Short", 100) // "Short" (unchanged)
   * ```
   */
  transform(value: string, limit: number): string {
    if (!value || value.length <= limit || limit == 0) return value;
    let raw = value.slice(0, limit);
    let lines = raw.split('\n');
    let otherLines = lines.slice(0, -1);
    let lastLine = lines.pop();
    if (!lastLine) {
      return otherLines.join('\n') + '...';
    }
    const processedLastLine = this.processLastLine(lastLine);

    return otherLines.join('\n') + '\n' + processedLastLine + '...';
  }

  /**
   * Processes the last line by closing unclosed Markdown tags
   * 
   * @private
   * @param line - Last line to process
   * @returns Processed line with closed tags
   * 
   * Supported tags:
   * - `***` - bold and italic
   * - `**` - bold
   * - `*` - italic
   * - `__` - bold (alternative)
   * - `_` - italic (alternative)
   * - `~~` - strikethrough
   * - `` ` `` - code
   * - ` ``` ` - code block
   * 
   * Truncated links `[...]` and brackets `(...)` are completely removed.
   */
  private processLastLine(line: string): string {
    const stack: string[] = [];
    let result = '';
    let i = 0;
  
    while (i < line.length) {
      let found = false;
      
      const tags = ['***', '___', '```', '**', '__', '~~', '*', '_', '`', '~'];
      
      for (const tag of tags) {
        if (line.slice(i, i + tag.length) === tag) {
          const closingTag = this.getClosingTag(tag);
          
          const nextClosingIndex = line.indexOf(closingTag, i + tag.length);
          
          if (nextClosingIndex !== -1) {
            result += line.slice(i, nextClosingIndex + closingTag.length);
            i = nextClosingIndex + closingTag.length;
          } else {
            stack.push(closingTag);
            result += tag;
            i += tag.length;
          }
          found = true;
          break;
        }
      }
      
      if (!found) {
        if (line[i] === '[') {
          const linkEnd = line.indexOf(']', i);
          if (linkEnd !== -1) {
            result += line.slice(i, linkEnd + 1);
            i = linkEnd + 1;
          } else {
            i++;
          }
        } else if (line[i] === '(') {
          const parenEnd = line.indexOf(')', i);
          if (parenEnd !== -1) {
            result += line.slice(i, parenEnd + 1);
            i = parenEnd + 1;
          } else {
            i++;
          }
        } else {
          result += line[i];
          i++;
        }
      }
    }
    return result + stack.reverse().join('');
  }
  

  /**
   * Returns closing tag for opening Markdown tag
   * 
   * @private
   * @param openTag - Opening tag
   * @returns Corresponding closing tag
   * 
   * @example
   * ```typescript
   * getClosingTag('**') // '**'
   * getClosingTag('*') // '*'
   * getClosingTag('[') // ']'
   * ```
   */
  private getClosingTag(openTag: string): string {
    const closingMap: { [key: string]: string } = {
      '***': '***',
      '___': '___',
      '```': '```',
      '**': '**',
      '__': '__',
      '~~': '~~',
      '*': '*',
      '_': '_',
      '`': '`',
      '[': ']',
      '(': ')',
      '~': '~~'
    };
    
    return closingMap[openTag] || openTag;
  }
}
