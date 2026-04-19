const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const { Exam, Result } = require('./models/schemas');
const { parseDocx } = require('./utils/parser');
require('dotenv').config();

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/azota_mini';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err));

// Admin Auth Middleware (Simple)
const adminAuth = (req, res, next) => {
    const adminName = req.headers['x-admin-name'];
    if (adminName === 'wantech') {
        next();
    } else {
        res.status(401).json({ error: 'Unauthorized' });
    }
};

// Routes
app.post('/api/exams/parse', adminAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
        const questions = await parseDocx(req.file.buffer);
        res.json({ questions });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to parse file' });
    }
});

app.post('/api/exams', adminAuth, async (req, res) => {
    try {
        const { title, description, questions } = req.body;
        if (!questions || questions.length === 0) {
            return res.status(400).json({ error: 'No questions provided' });
        }

        // Sanitize: strip any extra fields, ensure content & options are valid strings
        const cleanQuestions = questions.map(q => ({
            content: String(q.content || '').trim(),
            options: (q.options || []).map(opt => ({
                text: String(opt.text || '').trim(),
                isCorrect: Boolean(opt.isCorrect)
            })).filter(opt => opt.text.length > 0)
        })).filter(q => q.content.length > 0 && q.options.length > 0);

        if (cleanQuestions.length === 0) {
            return res.status(400).json({ error: 'All questions were empty after cleanup' });
        }

        const exam = new Exam({
            title: title || 'Đề thi không tên',
            description: description || '',
            questions: cleanQuestions
        });

        await exam.save();
        res.json({ message: 'Exam created successfully', examId: exam._id });
    } catch (error) {
        console.error('=== LỖI KHI LƯU ĐỀ ===');
        console.error('Message:', error.message);
        if (error.errors) {
            Object.keys(error.errors).forEach(key => {
                console.error(`  Field [${key}]:`, error.errors[key].message);
            });
        }
        res.status(500).json({ error: 'Failed to save exam', detail: error.message });
    }
});

app.delete('/api/exams/:id', adminAuth, async (req, res) => {
    console.log('Nhận yêu cầu xóa đề thi, ID:', req.params.id);
    try {
        const exam = await Exam.findByIdAndDelete(req.params.id);
        if (!exam) {
            console.log('Không tìm thấy đề thi để xóa');
            return res.status(404).json({ error: 'Exam not found' });
        }
        // Also delete associated results
        const resultsDeleted = await Result.deleteMany({ examId: req.params.id });
        console.log(`Đã xóa đề thi và ${resultsDeleted.deletedCount} kết quả liên quan.`);
        res.json({ message: 'Exam and results deleted successfully' });
    } catch (error) {
        console.error('Lỗi khi xử lý xóa đề trên server:', error);
        res.status(500).json({ error: 'Failed to delete exam' });
    }
});

app.get('/api/exams', async (req, res) => {
    try {
        const exams = await Exam.find({}, 'title description createdAt').sort({ createdAt: -1 });
        res.json(exams);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exams' });
    }
});

app.get('/api/exams/:id', async (req, res) => {
    try {
        const exam = await Exam.findById(req.params.id);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });
        res.json(exam);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch exam' });
    }
});

app.post('/api/exams/:id/submit', async (req, res) => {
    try {
        const { studentName, answers } = req.body;
        const exam = await Exam.findById(req.params.id);
        if (!exam) return res.status(404).json({ error: 'Exam not found' });

        let score = 0;
        exam.questions.forEach((q, index) => {
            const studentChoice = answers[index];
            if (studentChoice !== undefined && q.options[studentChoice] && q.options[studentChoice].isCorrect) {
                score++;
            }
        });

        const result = new Result({
            examId: exam._id,
            studentName: studentName,
            answers: answers,
            score: score,
            totalQuestions: exam.questions.length
        });

        await result.save();
        res.json({ 
            score: score, 
            totalQuestions: exam.questions.length,
            resultId: result._id 
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to submit result' });
    }
});

app.get('/api/exams/:id/results', adminAuth, async (req, res) => {
    try {
        const results = await Result.find({ examId: req.params.id }).sort({ submittedAt: -1 });
        res.json(results);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch results' });
    }
});

// Local development: start the server directly
// Vercel: export the app as a serverless function
if (process.env.VERCEL !== '1') {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
    });
}

module.exports = app;
