/**
 * Suno Downloader Pro - Lyrics & Subtitle Engine
 * Parses lyrics/prompts into timed karaoke cues and exports .TXT, .LRC, and .SRT formats.
 */

export class LyricsUtils {
  /**
   * Parses raw lyrics string into structured timed cues across totalDuration
   * @param {string} rawLyrics
   * @param {number} totalDuration - Song duration in seconds
   * @returns {Array<{ start: number, end: number, text: string, isSection: boolean }>}
   */
  static getTimedCues(rawLyrics, totalDuration = 180) {
    if (!rawLyrics || !String(rawLyrics).trim()) return [];

    const dur = Math.max(10, Number(totalDuration) || 180);
    const rawLines = String(rawLyrics)
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    if (rawLines.length === 0) return [];

    // Check if lines already contain [mm:ss.xx] LRC timestamps
    const lrcRegex = /^\[(\d{1,2}):(\d{2}(?:\.\d{1,3})?)\]\s*(.*)$/;
    const preTimed = [];
    for (const line of rawLines) {
      const m = line.match(lrcRegex);
      if (m) {
        const sec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
        const txt = m[3].trim();
        if (txt) preTimed.push({ start: sec, text: txt, isSection: /^\[.*\]$/.test(txt) });
      }
    }

    if (preTimed.length >= 3) {
      preTimed.sort((a, b) => a.start - b.start);
      return preTimed.map((item, idx) => ({
        start: item.start,
        end: idx + 1 < preTimed.length ? preTimed[idx + 1].start : dur,
        text: item.text,
        isSection: item.isSection
      }));
    }

    // Weight-based proportional timing across song duration (leaving subtle intro/outro margin)
    const introOffset = Math.min(3.5, dur * 0.03);
    const outroMargin = Math.min(4.0, dur * 0.03);
    const activeWindow = Math.max(5, dur - introOffset - outroMargin);

    const parsedItems = rawLines.map(line => {
      const isSection = /^\[.*\]$/.test(line);
      const isInstrumental = isSection && /solo|instrumental|break|intro|outro|interlude/i.test(line);
      // Instrumental breaks hold screen time longer; section tags alone are brief markers
      let weight = Math.max(10, line.length);
      if (isInstrumental) {
        weight = 65;
      } else if (isSection) {
        weight = 8;
      }
      return { text: line, isSection, isInstrumental, weight };
    });

    const totalWeight = parsedItems.reduce((sum, item) => sum + item.weight, 0) || 1;
    let cursor = introOffset;

    return parsedItems.map(item => {
      const span = (item.weight / totalWeight) * activeWindow;
      const cue = {
        start: cursor,
        end: cursor + span,
        text: item.text,
        isSection: item.isSection
      };
      cursor += span;
      return cue;
    });
  }

  /**
   * Formats seconds as LRC timestamp [mm:ss.xx]
   */
  static formatLrcTimestamp(sec) {
    const clamped = Math.max(0, sec);
    const mins = Math.floor(clamped / 60);
    const rem = clamped - mins * 60;
    const secs = Math.floor(rem);
    const hundredths = Math.floor((rem - secs) * 100);
    const mm = String(mins).padStart(2, '0');
    const ss = String(secs).padStart(2, '0');
    const xx = String(hundredths).padStart(2, '0');
    return `[${mm}:${ss}.${xx}]`;
  }

  /**
   * Formats seconds as SRT timestamp HH:MM:SS,mmm
   */
  static formatSrtTimestamp(sec) {
    const clamped = Math.max(0, sec);
    const hrs = Math.floor(clamped / 3600);
    const mins = Math.floor((clamped % 3600) / 60);
    const secs = Math.floor(clamped % 60);
    const ms = Math.floor((clamped - Math.floor(clamped)) * 1000);
    return (
      String(hrs).padStart(2, '0') + ':' +
      String(mins).padStart(2, '0') + ':' +
      String(secs).padStart(2, '0') + ',' +
      String(ms).padStart(3, '0')
    );
  }

  /**
   * Generates synchronized .LRC file string
   */
  static toLrc(song, durationOverride = 0) {
    const dur = durationOverride || song.duration || 180;
    const cues = LyricsUtils.getTimedCues(song.prompt || '', dur);
    const header = [
      `[ti:${song.title || 'Suno Song'}]`,
      `[ar:Suno AI Studio]`,
      `[al:Suno Downloader Pro]`,
      `[length:${Math.floor(dur / 60)}:${String(Math.floor(dur % 60)).padStart(2, '0')}]`,
      ''
    ];
    if (cues.length === 0) {
      return header.concat(['[00:00.00] (Instrumental / No lyrics metadata)']).join('\n');
    }
    const body = cues.map(c => `${LyricsUtils.formatLrcTimestamp(c.start)} ${c.text}`);
    return header.concat(body).join('\n');
  }

  /**
   * Generates SubRip .SRT subtitle file string
   */
  static toSrt(song, durationOverride = 0) {
    const dur = durationOverride || song.duration || 180;
    const cues = LyricsUtils.getTimedCues(song.prompt || '', dur)
      .filter(c => !c.isSection || /solo|instrumental/i.test(c.text));

    if (cues.length === 0) {
      return `1\n00:00:00,000 --> ${LyricsUtils.formatSrtTimestamp(dur)}\n${song.title || 'Suno Track'}\n`;
    }

    return cues.map((c, idx) => {
      return `${idx + 1}\n${LyricsUtils.formatSrtTimestamp(c.start)} --> ${LyricsUtils.formatSrtTimestamp(c.end)}\n${c.text}\n`;
    }).join('\n');
  }

  /**
   * Generates clean .TXT lyrics & metadata sheet
   */
  static toTxt(song) {
    return [
      `Title: ${song.title || 'Suno Track'}`,
      `UUID: ${song.uuid || 'N/A'}`,
      `Model: ${song.model || 'Suno'}`,
      `Style / Tags: ${song.tags || 'N/A'}`,
      '',
      '=== LYRICS ===',
      '',
      song.prompt || '(No lyrics available for this track)'
    ].join('\n');
  }
}
