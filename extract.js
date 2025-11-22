const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');
const url = require('url');

ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = async (req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    // Robust parameter extraction
    let videoId, time;

    try {
        if (req.method === 'POST') {
            ({ videoId, time } = req.body || {});
        } else {
            // Try req.query first (Vercel standard)
            if (req.query && req.query.videoId) {
                ({ videoId, time } = req.query);
            } else {
                // Fallback: Manual URL parsing
                const queryParams = url.parse(req.url, true).query;
                ({ videoId, time } = queryParams);
            }
        }
    } catch (e) {
        console.error("Error parsing parameters", e);
    }

    if (!videoId || time === undefined) {
        return res.status(400).json({
            error: 'Missing videoId or time',
            debug: {
                receivedQuery: req.query,
                receivedBody: req.body,
                method: req.method,
                url: req.url
            }
        });
    }

    try {
        // Get video info
        const info = await ytdl.getInfo(videoId);

        // Choose the best video format (we don't need audio for a screenshot)
        const format = ytdl.chooseFormat(info.formats, { quality: 'highestvideo' });

        if (!format || !format.url) {
            throw new Error('No suitable video format found');
        }

        const videoUrl = format.url;
        const timeInSeconds = parseFloat(time);

        // Create a PassThrough stream to capture the image data
        const imageStream = new PassThrough();
        const chunks = [];

        imageStream.on('data', (chunk) => chunks.push(chunk));

        await new Promise((resolve, reject) => {
            ffmpeg(videoUrl)
                .seekInput(timeInSeconds)
                .frames(1)
                .format('image2')
                .outputOptions('-vcodec', 'mjpeg') // Ensure output is JPEG
                .on('error', (err) => {
                    console.error('FFmpeg error:', err);
                    reject(err);
                })
                .on('end', () => resolve())
                .pipe(imageStream, { end: true });
        });

        const buffer = Buffer.concat(chunks);
        const base64Image = buffer.toString('base64');
        const dataUrl = `data:image/jpeg;base64,${base64Image}`;

        res.status(200).json({ imageUrl: dataUrl });

    } catch (error) {
        console.error('Error processing video:', error);
        res.status(500).json({ error: error.message });
    }
};
