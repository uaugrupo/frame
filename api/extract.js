const ytdl = require('@distube/ytdl-core');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { PassThrough } = require('stream');

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

    const { videoId, time } = req.method === 'POST' ? req.body : req.query;

    if (!videoId || time === undefined) {
        return res.status(400).json({ error: 'Missing videoId or time' });
    }

    try {
        // Get video info
        const info = await ytdl.getInfo(videoId);

        // Choose the best video format (we don't need audio for a screenshot)
        // Using 'highestvideo' usually gives a good quality stream.
        // We can also filter for formats that have video.
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
