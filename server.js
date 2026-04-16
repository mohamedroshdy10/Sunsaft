const express = require('express');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Ensure uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// Multer config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1000) + ext);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Images only'));
    }
});

// Database
const db = new Database(path.join(__dirname, 'sunsaft.db'));
db.pragma('journal_mode = WAL');

db.exec(`
    CREATE TABLE IF NOT EXISTS people (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL,
        specialty TEXT NOT NULL,
        details TEXT DEFAULT '',
        in_village TEXT DEFAULT 'yes',
        schedule TEXT DEFAULT '',
        photo TEXT DEFAULT '',
        pin TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
`);

// API Routes

// Get all people (without pin)
app.get('/api/people', (req, res) => {
    const people = db.prepare(`
        SELECT id, name, phone, specialty, details, in_village, schedule, photo, created_at
        FROM people ORDER BY created_at DESC
    `).all();
    res.json(people);
});

// Get single person (without pin)
app.get('/api/people/:id', (req, res) => {
    const person = db.prepare(`
        SELECT id, name, phone, specialty, details, in_village, schedule, photo, created_at
        FROM people WHERE id = ?
    `).get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    res.json(person);
});

// Add new person
app.post('/api/people', upload.single('photo'), (req, res) => {
    const { name, phone, specialty, details, in_village, schedule, pin } = req.body;
    if (!name || !phone || !specialty || !pin) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    const photo = req.file ? '/uploads/' + req.file.filename : '';
    const result = db.prepare(`
        INSERT INTO people (name, phone, specialty, details, in_village, schedule, photo, pin)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, phone, specialty, details || '', in_village || 'yes', schedule || '', photo, pin);
    res.json({ id: result.lastInsertRowid, message: 'OK' });
});

// Verify PIN only (no data change)
app.post('/api/people/:id/verify-pin', (req, res) => {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const person = db.prepare('SELECT pin FROM people WHERE id = ?').get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    if (person.pin !== pin) return res.status(403).json({ error: 'Wrong PIN' });

    res.json({ message: 'PIN correct' });
});

// Edit person (requires correct pin)
app.put('/api/people/:id', upload.single('photo'), (req, res) => {
    const { name, phone, specialty, details, in_village, schedule, pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const person = db.prepare('SELECT pin, photo FROM people WHERE id = ?').get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    if (person.pin !== pin) return res.status(403).json({ error: 'Wrong PIN' });

    const photo = req.file ? '/uploads/' + req.file.filename : (req.body.keep_photo === 'true' ? person.photo : person.photo);

    db.prepare(`
        UPDATE people SET name=?, phone=?, specialty=?, details=?, in_village=?, schedule=?, photo=?
        WHERE id=?
    `).run(name, phone, specialty, details || '', in_village || 'yes', schedule || '', photo, req.params.id);
    res.json({ message: 'Updated' });
});

// Delete person (requires correct pin)
app.delete('/api/people/:id', (req, res) => {
    const { pin } = req.body;
    if (!pin) return res.status(400).json({ error: 'PIN required' });

    const person = db.prepare('SELECT pin, photo FROM people WHERE id = ?').get(req.params.id);
    if (!person) return res.status(404).json({ error: 'Not found' });
    if (person.pin !== pin) return res.status(403).json({ error: 'Wrong PIN' });

    // Delete photo file if exists
    if (person.photo) {
        const photoPath = path.join(__dirname, person.photo);
        if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
    }

    db.prepare('DELETE FROM people WHERE id = ?').run(req.params.id);
    res.json({ message: 'Deleted' });
});

// Start
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
