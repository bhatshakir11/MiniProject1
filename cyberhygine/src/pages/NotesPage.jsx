import React, { useState } from "react";
import Navbar from "../components/Navbar";

const NotesPage = () => {
  const [notes, setNotes] = useState([
    { id: 1, title: "Bank PIN", content: "1234 (encrypted)" },
    { id: 2, title: "WiFi Password", content: "mywifipass (encrypted)" },
  ]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ title: "", content: "" });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleAdd = (e) => {
    e.preventDefault();
    setNotes([...notes, { ...form, id: Date.now() }]);
    setShowAdd(false);
    setForm({ title: "", content: "" });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-blue-900">
      <Navbar />
      <div className="max-w-3xl mx-auto py-8 px-4">
        <h2 className="text-3xl font-bold text-white mb-6">Encrypted Notes</h2>
        <button
          className="mb-4 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          onClick={() => setShowAdd(true)}
        >
          Add Note
        </button>
        {showAdd && (
          <form onSubmit={handleAdd} className="bg-white/10 rounded-xl p-6 mb-6">
            <div className="mb-4">
              <label className="block text-white mb-1">Title</label>
              <input name="title" value={form.title} onChange={handleChange} required className="w-full px-3 py-2 rounded bg-white/20 text-white" />
            </div>
            <div className="mb-4">
              <label className="block text-white mb-1">Content</label>
              <textarea name="content" value={form.content} onChange={handleChange} required className="w-full px-3 py-2 rounded bg-white/20 text-white" />
            </div>
            <button type="submit" className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded">Save</button>
            <button type="button" className="ml-2 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded" onClick={() => setShowAdd(false)}>Cancel</button>
          </form>
        )}
        <div className="bg-white/10 rounded-xl p-6">
          <ul className="text-white">
            {notes.map((note) => (
              <li key={note.id} className="mb-2">
                <span className="font-bold">{note.title}:</span> {note.content}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default NotesPage;
