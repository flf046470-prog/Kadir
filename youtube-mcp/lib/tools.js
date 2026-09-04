/**
 * MCP tool surface for the ScareWithin YouTube channel.
 *
 * Every tool runs against the authenticated user's own channel. Irreversible
 * operations require an explicit confirmation argument so a model can never
 * destroy content on its own initiative.
 */

import { data, analyticsQuery, uploadVideo, setThumbnail } from './google.js';
import { readOnlyMode, monetaryAnalyticsEnabled } from './config.js';

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** Cache the caller's own channel for the lifetime of one request. */
async function myChannel(ctx) {
  if (!ctx._channel) {
    const res = await data.get(ctx.token, 'channels', {
      part: 'snippet,statistics,contentDetails,brandingSettings,status',
      mine: 'true',
    });
    const ch = res.items?.[0];
    if (!ch) throw new Error('No YouTube channel is attached to the authorized Google account.');
    ctx._channel = ch;
  }
  return ctx._channel;
}

function videoSummary(v) {
  return {
    videoId: v.id?.videoId || v.id,
    title: v.snippet?.title,
    description: v.snippet?.description?.slice(0, 400),
    publishedAt: v.snippet?.publishedAt,
    privacyStatus: v.status?.privacyStatus,
    duration: v.contentDetails?.duration,
    thumbnail: v.snippet?.thumbnails?.medium?.url || v.snippet?.thumbnails?.default?.url,
    stats: v.statistics && {
      views: Number(v.statistics.viewCount || 0),
      likes: Number(v.statistics.likeCount || 0),
      comments: Number(v.statistics.commentCount || 0),
    },
  };
}

/** Turn an Analytics API column/row response into readable objects. */
function shapeReport(report) {
  const cols = (report.columnHeaders || []).map((c) => c.name);
  return {
    columns: cols,
    rows: (report.rows || []).map((row) => Object.fromEntries(cols.map((c, i) => [c, row[i]]))),
    totalRows: report.rows?.length || 0,
  };
}

/* ------------------------------------------------------------------ *
 * Tool definitions
 * ------------------------------------------------------------------ */

const READ_TOOLS = [
  {
    name: 'youtube_auth_status',
    description:
      'Confirm which YouTube channel the current authorization is attached to, and which permission scopes were granted. Use this first to verify the connection.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx) {
      const ch = await myChannel(ctx);
      return {
        authenticated: true,
        channelId: ch.id,
        channelTitle: ch.snippet?.title,
        grantedScopes: ctx.scopes,
        readOnlyMode: readOnlyMode(),
      };
    },
  },
  {
    name: 'youtube_get_channel',
    description:
      'Read full details of the authenticated channel: title, description, custom URL, country, creation date, subscriber count, total views, video count, and the uploads playlist id.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx) {
      const ch = await myChannel(ctx);
      return {
        channelId: ch.id,
        title: ch.snippet?.title,
        description: ch.snippet?.description,
        customUrl: ch.snippet?.customUrl,
        country: ch.snippet?.country,
        publishedAt: ch.snippet?.publishedAt,
        thumbnail: ch.snippet?.thumbnails?.high?.url,
        subscriberCount: Number(ch.statistics?.subscriberCount || 0),
        subscriberCountHidden: Boolean(ch.statistics?.hiddenSubscriberCount),
        viewCount: Number(ch.statistics?.viewCount || 0),
        videoCount: Number(ch.statistics?.videoCount || 0),
        uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
        keywords: ch.brandingSettings?.channel?.keywords,
        longUploadsStatus: ch.status?.longUploadsStatus,
      };
    },
  },
  {
    name: 'youtube_list_videos',
    description:
      'List the most recent uploads on the authenticated channel, newest first, including view/like/comment statistics for each. Use pageToken to page through older uploads.',
    inputSchema: {
      type: 'object',
      properties: {
        maxResults: int('How many videos to return (1-50, default 10)', { minimum: 1, maximum: 50 }),
        pageToken: str('Token from a previous call to fetch the next page'),
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const ch = await myChannel(ctx);
      const uploads = ch.contentDetails?.relatedPlaylists?.uploads;
      if (!uploads) throw new Error('This channel has no uploads playlist.');

      const page = await data.get(ctx.token, 'playlistItems', {
        part: 'snippet,contentDetails',
        playlistId: uploads,
        maxResults: Math.min(Math.max(args.maxResults || 10, 1), 50),
        pageToken: args.pageToken,
      });

      const ids = (page.items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
      if (!ids.length) return { channelTitle: ch.snippet?.title, videos: [], nextPageToken: page.nextPageToken };

      const details = await data.get(ctx.token, 'videos', {
        part: 'snippet,statistics,status,contentDetails',
        id: ids,
      });

      return {
        channelTitle: ch.snippet?.title,
        totalUploads: Number(ch.statistics?.videoCount || 0),
        videos: (details.items || []).map(videoSummary),
        nextPageToken: page.nextPageToken,
      };
    },
  },
  {
    name: 'youtube_search',
    description:
      'Search YouTube for videos. Set mine=true to search only within the authenticated channel; otherwise this searches all of YouTube (useful for competitor and topic research).',
    inputSchema: {
      type: 'object',
      properties: {
        query: str('Search terms'),
        mine: { type: 'boolean', description: 'Restrict results to the authenticated channel (default false)' },
        maxResults: int('How many results (1-50, default 10)', { minimum: 1, maximum: 50 }),
        order: str('Sort order', { enum: ['relevance', 'date', 'viewCount', 'rating', 'title'] }),
        publishedAfter: str('Only results published after this RFC 3339 date, e.g. 2026-01-01T00:00:00Z'),
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const params = {
        part: 'snippet',
        type: 'video',
        q: args.query,
        maxResults: Math.min(Math.max(args.maxResults || 10, 1), 50),
        order: args.order,
        publishedAfter: args.publishedAfter,
      };
      if (args.mine) params.forMine = 'true';
      const res = await data.get(ctx.token, 'search', params);
      return {
        results: (res.items || []).map((i) => ({
          videoId: i.id?.videoId,
          title: i.snippet?.title,
          channelTitle: i.snippet?.channelTitle,
          publishedAt: i.snippet?.publishedAt,
          description: i.snippet?.description,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  },
  {
    name: 'youtube_get_video',
    description: 'Read full metadata and statistics for one or more videos by id: title, description, tags, category, privacy status, duration and counts.',
    inputSchema: {
      type: 'object',
      properties: { videoIds: { type: 'array', items: { type: 'string' }, description: 'One or more YouTube video ids (max 50)' } },
      required: ['videoIds'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const res = await data.get(ctx.token, 'videos', {
        part: 'snippet,statistics,status,contentDetails,topicDetails',
        id: args.videoIds.slice(0, 50),
      });
      return {
        videos: (res.items || []).map((v) => ({
          ...videoSummary(v),
          fullDescription: v.snippet?.description,
          tags: v.snippet?.tags,
          categoryId: v.snippet?.categoryId,
          defaultLanguage: v.snippet?.defaultLanguage,
          madeForKids: v.status?.madeForKids,
          licensedContent: v.contentDetails?.licensedContent,
        })),
      };
    },
  },
  {
    name: 'youtube_list_playlists',
    description: 'List the playlists owned by the authenticated channel, with item counts and privacy status.',
    inputSchema: {
      type: 'object',
      properties: { maxResults: int('How many playlists (1-50, default 25)', { minimum: 1, maximum: 50 }), pageToken: str('Next page token') },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const res = await data.get(ctx.token, 'playlists', {
        part: 'snippet,contentDetails,status',
        mine: 'true',
        maxResults: Math.min(Math.max(args.maxResults || 25, 1), 50),
        pageToken: args.pageToken,
      });
      return {
        playlists: (res.items || []).map((p) => ({
          playlistId: p.id,
          title: p.snippet?.title,
          description: p.snippet?.description,
          itemCount: p.contentDetails?.itemCount,
          privacyStatus: p.status?.privacyStatus,
          publishedAt: p.snippet?.publishedAt,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  },
  {
    name: 'youtube_list_comments',
    description:
      'Read comment threads, either for one video (pass videoId) or across the whole channel (omit videoId). Includes existing replies so you can see what has already been answered.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: str('Limit to a single video. Omit to read comments across the entire channel.'),
        maxResults: int('How many threads (1-100, default 20)', { minimum: 1, maximum: 100 }),
        order: str('Sort order', { enum: ['time', 'relevance'] }),
        pageToken: str('Next page token'),
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const params = {
        part: 'snippet,replies',
        maxResults: Math.min(Math.max(args.maxResults || 20, 1), 100),
        order: args.order || 'time',
        pageToken: args.pageToken,
        textFormat: 'plainText',
      };
      if (args.videoId) params.videoId = args.videoId;
      else params.allThreadsRelatedToChannelId = (await myChannel(ctx)).id;

      const res = await data.get(ctx.token, 'commentThreads', params);
      return {
        threads: (res.items || []).map((t) => {
          const top = t.snippet?.topLevelComment?.snippet;
          return {
            threadId: t.id,
            commentId: t.snippet?.topLevelComment?.id,
            videoId: t.snippet?.videoId,
            author: top?.authorDisplayName,
            text: top?.textDisplay,
            likeCount: top?.likeCount,
            publishedAt: top?.publishedAt,
            totalReplyCount: t.snippet?.totalReplyCount,
            replies: (t.replies?.comments || []).map((r) => ({
              commentId: r.id,
              author: r.snippet?.authorDisplayName,
              text: r.snippet?.textDisplay,
              publishedAt: r.snippet?.publishedAt,
            })),
          };
        }),
        nextPageToken: res.nextPageToken,
      };
    },
  },
  {
    name: 'youtube_analytics_channel',
    description:
      'Channel-level performance from the YouTube Analytics API over a date range: views, watch time, average view duration, subscribers gained/lost, likes, shares and comments. Optionally break the numbers down by a dimension such as day or country.',
    inputSchema: {
      type: 'object',
      properties: {
        startDate: str('YYYY-MM-DD (default: 28 days ago)'),
        endDate: str('YYYY-MM-DD (default: today)'),
        dimensions: str('Optional breakdown', { enum: ['day', 'month', 'country', 'insightTrafficSourceType', 'deviceType', 'ageGroup,gender', 'subscribedStatus'] }),
        sort: str('Sort column, prefix with - for descending (e.g. -views)'),
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const report = await analyticsQuery(ctx.token, {
        ids: 'channel==MINE',
        startDate: args.startDate || daysAgo(28),
        endDate: args.endDate || daysAgo(0),
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,likes,shares,comments',
        dimensions: args.dimensions,
        sort: args.sort,
        maxResults: args.dimensions ? 200 : undefined,
      });
      return { period: { start: args.startDate || daysAgo(28), end: args.endDate || daysAgo(0) }, ...shapeReport(report) };
    },
  },
  {
    name: 'youtube_analytics_video',
    description:
      'Per-video performance from the YouTube Analytics API. Pass videoIds to analyse specific videos, or omit them to get the top videos on the channel ranked by views for the period.',
    inputSchema: {
      type: 'object',
      properties: {
        videoIds: { type: 'array', items: { type: 'string' }, description: 'Specific video ids to analyse. Omit for a top-videos ranking.' },
        startDate: str('YYYY-MM-DD (default: 28 days ago)'),
        endDate: str('YYYY-MM-DD (default: today)'),
        maxResults: int('How many videos in a top-videos ranking (default 10)', { minimum: 1, maximum: 200 }),
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const startDate = args.startDate || daysAgo(28);
      const endDate = args.endDate || daysAgo(0);
      const metrics = 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,dislikes,shares,comments';

      const params = { ids: 'channel==MINE', startDate, endDate, metrics, dimensions: 'video', maxResults: args.maxResults || 10, sort: '-views' };
      if (args.videoIds?.length) {
        params.filters = `video==${args.videoIds.slice(0, 200).join(',')}`;
        params.maxResults = Math.max(args.videoIds.length, 1);
      }
      const report = await analyticsQuery(ctx.token, params);
      return { period: { start: startDate, end: endDate }, ...shapeReport(report) };
    },
  },
  {
    name: 'youtube_analytics_query',
    description:
      'Run an arbitrary YouTube Analytics API v2 report against the authenticated channel. Use this for metrics or dimensions the dedicated analytics tools do not cover (traffic sources, audience retention, demographics, playlists).',
    inputSchema: {
      type: 'object',
      properties: {
        metrics: str('Comma-separated metrics, e.g. views,estimatedMinutesWatched'),
        dimensions: str('Comma-separated dimensions, e.g. day or insightTrafficSourceType'),
        filters: str('Filter expression, e.g. video==abc123'),
        startDate: str('YYYY-MM-DD (default: 28 days ago)'),
        endDate: str('YYYY-MM-DD (default: today)'),
        sort: str('Sort column, prefix with - for descending'),
        maxResults: int('Row limit', { minimum: 1, maximum: 500 }),
      },
      required: ['metrics'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      if (!monetaryAnalyticsEnabled() && /revenue|Revenue|rpm|RPM|cpm|CPM|adImpressions/.test(args.metrics)) {
        throw new Error(
          'Revenue metrics need the yt-analytics-monetary.readonly scope. Set ENABLE_REVENUE_ANALYTICS=1 on the deployment and reconnect the connector to grant it.',
        );
      }
      const report = await analyticsQuery(ctx.token, {
        ids: 'channel==MINE',
        startDate: args.startDate || daysAgo(28),
        endDate: args.endDate || daysAgo(0),
        metrics: args.metrics,
        dimensions: args.dimensions,
        filters: args.filters,
        sort: args.sort,
        maxResults: args.maxResults,
      });
      return shapeReport(report);
    },
  },
  {
    name: 'youtube_list_playlist_items',
    description: 'List the videos in a playlist, including each entry playlistItemId (needed to remove an entry).',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: str('Playlist to read'),
        maxResults: int('How many entries (1-50, default 25)', { minimum: 1, maximum: 50 }),
        pageToken: str('Next page token'),
      },
      required: ['playlistId'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(ctx, args) {
      const res = await data.get(ctx.token, 'playlistItems', {
        part: 'snippet,contentDetails',
        playlistId: args.playlistId,
        maxResults: Math.min(Math.max(args.maxResults || 25, 1), 50),
        pageToken: args.pageToken,
      });
      return {
        items: (res.items || []).map((i) => ({
          playlistItemId: i.id,
          videoId: i.contentDetails?.videoId,
          title: i.snippet?.title,
          position: i.snippet?.position,
        })),
        nextPageToken: res.nextPageToken,
      };
    },
  },
];

const WRITE_TOOLS = [
  {
    name: 'youtube_update_video',
    description:
      'Update metadata on an existing video: title, description, tags, category or privacy status. Only the fields you pass are changed; the rest are preserved.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: str('The video to update'),
        title: str('New title (max 100 characters)'),
        description: str('New description'),
        tags: { type: 'array', items: { type: 'string' }, description: 'Replacement tag list' },
        categoryId: str('YouTube category id, e.g. 24 for Entertainment'),
        privacyStatus: str('New privacy status', { enum: ['private', 'unlisted', 'public'] }),
      },
      required: ['videoId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(ctx, args) {
      const current = await data.get(ctx.token, 'videos', { part: 'snippet,status', id: args.videoId });
      const v = current.items?.[0];
      if (!v) throw new Error(`Video ${args.videoId} was not found on this channel.`);

      // The Data API replaces the whole snippet, so merge onto what exists.
      const snippet = {
        title: args.title ?? v.snippet.title,
        description: args.description ?? v.snippet.description,
        tags: args.tags ?? v.snippet.tags,
        categoryId: args.categoryId ?? v.snippet.categoryId,
      };
      const body = { id: args.videoId, snippet };
      let parts = 'snippet';
      if (args.privacyStatus) {
        body.status = { ...v.status, privacyStatus: args.privacyStatus };
        parts = 'snippet,status';
      }
      const res = await data.put(ctx.token, 'videos', { part: parts }, body);
      return { updated: true, videoId: res.id, title: res.snippet?.title, privacyStatus: res.status?.privacyStatus };
    },
  },
  {
    name: 'youtube_upload_video',
    description:
      'Upload a new video from a publicly reachable HTTPS URL. The file is fetched by the server and forwarded to YouTube. Defaults to private so you can review before publishing. Note: this deployment can only handle files up to about 64 MB within the serverless execution window — use YouTube Studio for larger files.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceUrl: str('Public HTTPS URL of the video file'),
        title: str('Video title (max 100 characters)'),
        description: str('Video description'),
        tags: { type: 'array', items: { type: 'string' } },
        categoryId: str('YouTube category id (default 24 = Entertainment)'),
        privacyStatus: str('Privacy on publish (default private)', { enum: ['private', 'unlisted', 'public'] }),
        madeForKids: { type: 'boolean', description: 'Whether the video is made for kids (required by COPPA)' },
      },
      required: ['sourceUrl', 'title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ctx, args) {
      const res = await uploadVideo(ctx.token, {
        sourceUrl: args.sourceUrl,
        snippet: {
          title: args.title,
          description: args.description || '',
          tags: args.tags,
          categoryId: args.categoryId || '24',
        },
        status: {
          privacyStatus: args.privacyStatus || 'private',
          selfDeclaredMadeForKids: args.madeForKids ?? false,
        },
      });
      return {
        uploaded: true,
        videoId: res.id,
        title: res.snippet?.title,
        privacyStatus: res.status?.privacyStatus,
        url: res.id ? `https://www.youtube.com/watch?v=${res.id}` : undefined,
      };
    },
  },
  {
    name: 'youtube_set_thumbnail',
    description: 'Set a custom thumbnail on a video from a publicly reachable HTTPS image URL (JPEG or PNG, max 2 MB). Requires a verified channel.',
    inputSchema: {
      type: 'object',
      properties: { videoId: str('The video to update'), imageUrl: str('Public HTTPS URL of the image') },
      required: ['videoId', 'imageUrl'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async run(ctx, args) {
      const res = await setThumbnail(ctx.token, args.videoId, args.imageUrl);
      return { updated: true, videoId: args.videoId, thumbnail: res.items?.[0]?.high?.url || res.items?.[0]?.default?.url };
    },
  },
  {
    name: 'youtube_create_playlist',
    description: 'Create a new playlist on the authenticated channel.',
    inputSchema: {
      type: 'object',
      properties: {
        title: str('Playlist title'),
        description: str('Playlist description'),
        privacyStatus: str('Privacy (default private)', { enum: ['private', 'unlisted', 'public'] }),
      },
      required: ['title'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ctx, args) {
      const res = await data.post(ctx.token, 'playlists', { part: 'snippet,status' }, {
        snippet: { title: args.title, description: args.description || '' },
        status: { privacyStatus: args.privacyStatus || 'private' },
      });
      return { created: true, playlistId: res.id, title: res.snippet?.title, privacyStatus: res.status?.privacyStatus };
    },
  },
  {
    name: 'youtube_add_to_playlist',
    description: 'Add a video to a playlist.',
    inputSchema: {
      type: 'object',
      properties: {
        playlistId: str('Target playlist id'),
        videoId: str('Video to add'),
        position: int('Zero-based position in the playlist (default: append to the end)', { minimum: 0 }),
      },
      required: ['playlistId', 'videoId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ctx, args) {
      const snippet = { playlistId: args.playlistId, resourceId: { kind: 'youtube#video', videoId: args.videoId } };
      if (args.position !== undefined) snippet.position = args.position;
      const res = await data.post(ctx.token, 'playlistItems', { part: 'snippet' }, { snippet });
      return { added: true, playlistItemId: res.id, playlistId: args.playlistId, videoId: args.videoId };
    },
  },
  {
    name: 'youtube_remove_from_playlist',
    description:
      'Remove one entry from a playlist. Takes a playlistItemId, not a videoId — read the playlist with youtube_list_playlist_items first to find it.',
    inputSchema: {
      type: 'object',
      properties: { playlistItemId: str('The playlist item id to remove') },
      required: ['playlistItemId'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async run(ctx, args) {
      await data.del(ctx.token, 'playlistItems', { id: args.playlistItemId });
      return { removed: true, playlistItemId: args.playlistItemId };
    },
  },
  {
    name: 'youtube_reply_to_comment',
    description: 'Post a public reply to an existing comment. Pass the id of the top-level comment you are replying to.',
    inputSchema: {
      type: 'object',
      properties: { parentCommentId: str('Id of the comment being replied to'), text: str('Reply text') },
      required: ['parentCommentId', 'text'],
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async run(ctx, args) {
      const res = await data.post(ctx.token, 'comments', { part: 'snippet' }, {
        snippet: { parentId: args.parentCommentId, textOriginal: args.text },
      });
      return { replied: true, commentId: res.id, text: res.snippet?.textOriginal, publishedAt: res.snippet?.publishedAt };
    },
  },
  {
    name: 'youtube_moderate_comment',
    description:
      'Set the moderation status of a comment: publish it, hold it for review, or reject it. Rejecting hides the comment from viewers; it does not permanently delete it.',
    inputSchema: {
      type: 'object',
      properties: {
        commentIds: { type: 'array', items: { type: 'string' }, description: 'Comment ids to moderate' },
        moderationStatus: str('New status', { enum: ['published', 'heldForReview', 'rejected'] }),
        banAuthor: { type: 'boolean', description: 'Also ban the author from the channel. Only valid with moderationStatus=rejected.' },
      },
      required: ['commentIds', 'moderationStatus'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async run(ctx, args) {
      if (args.banAuthor && args.moderationStatus !== 'rejected') {
        throw new Error('banAuthor can only be used together with moderationStatus="rejected".');
      }
      await data.post(ctx.token, 'comments/setModerationStatus', {
        id: args.commentIds.join(','),
        moderationStatus: args.moderationStatus,
        banAuthor: args.banAuthor ? 'true' : undefined,
      });
      return { moderated: true, commentIds: args.commentIds, moderationStatus: args.moderationStatus, authorBanned: Boolean(args.banAuthor) };
    },
  },
  {
    name: 'youtube_delete_video',
    description:
      'Permanently delete a video from the channel. THIS CANNOT BE UNDONE. As a safety check you must pass confirm set to exactly the same value as videoId; the call is refused otherwise. Ask the user to confirm in their own words before calling this.',
    inputSchema: {
      type: 'object',
      properties: {
        videoId: str('The video to delete permanently'),
        confirm: str('Must be exactly the same string as videoId, as an explicit confirmation'),
      },
      required: ['videoId', 'confirm'],
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    async run(ctx, args) {
      if (args.confirm !== args.videoId) {
        throw new Error(
          `Deletion refused: "confirm" must exactly equal videoId ("${args.videoId}"). Confirm with the user first, then repeat the call with confirm set correctly.`,
        );
      }
      // Surface what is about to be lost, so the result is auditable.
      const current = await data.get(ctx.token, 'videos', { part: 'snippet', id: args.videoId });
      const title = current.items?.[0]?.snippet?.title;
      if (!title) throw new Error(`Video ${args.videoId} was not found on this channel; nothing was deleted.`);

      await data.del(ctx.token, 'videos', { id: args.videoId });
      return { deleted: true, videoId: args.videoId, deletedTitle: title };
    },
  },
];

export function listTools() {
  const tools = readOnlyMode() ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
  return tools.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations }));
}

export function findTool(name) {
  const tools = readOnlyMode() ? READ_TOOLS : [...READ_TOOLS, ...WRITE_TOOLS];
  return tools.find((t) => t.name === name) || null;
}

export function isWriteTool(name) {
  return WRITE_TOOLS.some((t) => t.name === name);
}
