/**
 * Suno Downloader Pro - Lyrics & Subtitle Engine
 * Parses lyrics/prompts into timed karaoke cues and exports .TXT, .LRC, and .SRT formats.
 */

export class LyricsUtils {
  /**
   * Strips non-sung Suno prompt/structure tags such as [Verse 1], [Pre-Chorus], [Chorus],
   * [Whispered], {Bridge}, or standalone unbracketed section headers, while preserving
   * sung backing-vocal ad-libs like (He sent you my way).
   * @param {string} line
   * @returns {string}
   */
  static stripPromptTags(line) {
    if (!line) return '';
    let cleaned = String(line)
      // Strip square-bracket directives [Pre-Chorus], [Verse 1: Soft], etc. (excluding LRC [mm:ss.xx])
      .replace(/\[(?![0-9]{1,2}:[0-9]{2}(?:\.[0-9]{1,3})?\])[^\]]*\]/g, '')
      // Strip curly-brace section directives {Chorus}, {Verse 1}, etc.
      .replace(/\{[^\}]*\}/g, '')
      // Strip standalone non-sung stage directions in parentheses like (Instrumental) or (Guitar Solo)
      .replace(/^\s*\((?:instrumental(?:\s+break)?|[\w\s]*solo|interlude|break|intro|outro|fade\s+out|end|music|silence|beat\s+drop)\)\s*$/gi, '')
      .trim();

    // Strip standalone unbracketed section headers like "Verse 1:", "Pre-Chorus:", "**Chorus**"
    if (/^(?:#+\s*|\*+\s*)?(?:verse|chorus|pre-?chorus|post-?chorus|final\s+chorus|bridge|intro|outro|hook|refrain|interlude|instrumental(?:\s+break)?)(?:\s+\d+)?\s*:?\s*(?:\*+)?$/i.test(cleaned)) {
      return '';
    }

    // Clear leftover markdown punctuation if a line was e.g. "**[Pre-Chorus]**"
    if (/^[#*\-\s_:]+$/.test(cleaned)) {
      return '';
    }

    return cleaned.replace(/\s{2,}/g, ' ').trim();
  }

  /**
   * Parses raw lyrics string into structured timed cues across totalDuration.
   * Non-sung structure tags ([Verse 1], [Pre-Chorus], [Chorus], [Guitar Solo], etc.)
   * are excluded from visible cues while preserving natural section/instrumental pauses.
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
    const preTimedEvents = [];
    let lrcMatchCount = 0;

    for (const line of rawLines) {
      const m = line.match(lrcRegex);
      if (m) {
        lrcMatchCount++;
        const sec = parseInt(m[1], 10) * 60 + parseFloat(m[2]);
        const cleanTxt = LyricsUtils.stripPromptTags(m[3]);
        // Keep empty timestamp lines as end-of-cue markers (for solos/section breaks), exclude from final visible cues
        preTimedEvents.push({ start: sec, text: cleanTxt });
      }
    }

    if (lrcMatchCount >= 3) {
      preTimedEvents.sort((a, b) => a.start - b.start);
      const syncedCues = [];
      for (let i = 0; i < preTimedEvents.length; i++) {
        const item = preTimedEvents[i];
        if (!item.text) continue; // Marker/tag line only terminates the previous cue
        const nextStart = i + 1 < preTimedEvents.length ? preTimedEvents[i + 1].start : dur;
        syncedCues.push({
          start: item.start,
          end: Math.max(item.start + 0.25, nextStart),
          text: item.text,
          isSection: false
        });
      }
      return syncedCues;
    }

    // Weight-based proportional timing across song duration (leaving subtle intro/outro margin)
    const introOffset = Math.min(3.5, dur * 0.03);
    const outroMargin = Math.min(4.0, dur * 0.03);
    const activeWindow = Math.max(5, dur - introOffset - outroMargin);

    const timelineItems = [];
    for (const line of rawLines) {
      const cleanTxt = LyricsUtils.stripPromptTags(line);
      if (!cleanTxt) {
        // Pure tag/section header line: never render text, but reserve pause time for solos/breaks/section breaths
        const isInstrumentalGap = /solo|instrumental|break|interlude|drop/i.test(line);
        const isIntroOutroTag = /intro|outro|fade/i.test(line);
        const pauseWeight = isInstrumentalGap ? 45 : (isIntroOutroTag ? 18 : 4);
        timelineItems.push({ text: '', isPause: true, weight: pauseWeight });
      } else {
        const weight = Math.max(10, cleanTxt.length);
        timelineItems.push({ text: cleanTxt, isPause: false, weight });
      }
    }

    const sungCount = timelineItems.filter(item => !item.isPause).length;
    if (sungCount === 0) return [];

    const totalWeight = timelineItems.reduce((sum, item) => sum + item.weight, 0) || 1;
    let cursor = introOffset;
    const cues = [];

    for (const item of timelineItems) {
      const span = (item.weight / totalWeight) * activeWindow;
      if (!item.isPause) {
        cues.push({
          start: cursor,
          end: cursor + span,
          text: item.text,
          isSection: false
        });
      }
      cursor += span;
    }

    return cues;
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
      `[ar:${song.artist || 'Suno AI Studio'}]`,
      `[al:${song.album || 'NTK Hub'}]`,
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

  /**
   * Searches free online open database (LRCLIB) for synchronized [mm:ss.xx] lyrics
   * 100% free, zero API key required, open CORS.
   */
  static async searchOnlineLyrics(trackName, artistName = '', duration = 0) {
    if (!trackName || !trackName.trim()) {
      throw new Error('Please provide a track title to search for lyrics.');
    }

    const cleanTitle = trackName.replace(/\(.*?\)|\[.*?\]/g, '').trim();
    const query = [cleanTitle, artistName].filter(Boolean).join(' ');

    const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'SunoDownloaderPro/2026.2' } });
    if (!resp.ok) {
      throw new Error(`Lyrics search returned HTTP ${resp.status}`);
    }

    const results = await resp.json();
    if (!Array.isArray(results) || results.length === 0) {
      throw new Error(`No lyrics found online for "${trackName}".`);
    }

    // Best match: prefer results with syncedLyrics
    let best = results.find(r => r.syncedLyrics);
    if (!best) best = results[0];

    return {
      trackName: best.trackName || best.name,
      artistName: best.artistName,
      albumName: best.albumName,
      duration: best.duration,
      syncedLyrics: best.syncedLyrics || null,
      plainLyrics: best.plainLyrics || null,
      isSynced: Boolean(best.syncedLyrics)
    };
  }
}
