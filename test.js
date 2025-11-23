const message = process.argv[2] || 'Test notification';
const priority = process.argv[3] || 'info';

fetch('http://localhost:3456/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message, priority })
})
.then(res => res.json())
.then(data => console.log('✅ Sent:', data))
.catch(err => console.error('❌ Error:', err.message));
