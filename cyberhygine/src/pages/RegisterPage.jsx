import React, { useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import AnimatedBackground from "../components/AnimatedBackground";
import API_BASE_URL from "../config";

const RegisterPage = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const navigate = useNavigate();

  const handleRegister = async (e) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    try {
      const res = await axios.post(`${API_BASE_URL}/register`, { username, password });
      if (res.data.success) {
        setSuccess("Account created! You can now log in.");
        setTimeout(() => navigate("/login"), 1500);
      } else {
        setError(res.data.message || "Registration failed");
      }
    } catch (err) {
      setError("Registration failed. Please try again.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <AnimatedBackground />
      <div className="glass-card rounded-2xl shadow-2xl p-8 w-full max-w-md relative z-10 animate-fade-in">
        <h2 className="text-4xl font-bold text-center bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-8">Register</h2>
        <form onSubmit={handleRegister}>
          <div className="mb-4">
            <label className="block text-cyan-300 font-semibold mb-2">Username</label>
            <input
              type="text"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-cyan-300 font-semibold mb-2">Password</label>
            <input
              type="password"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="mb-4">
            <label className="block text-cyan-300 font-semibold mb-2">Confirm Password</label>
            <input
              type="password"
              className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white focus:outline-none focus:border-cyan-400 transition-all"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error && <div className="text-red-400 mb-2 text-center">{error}</div>}
          {success && <div className="text-green-400 mb-2 text-center">{success}</div>}
          <button
            type="submit"
            className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white font-semibold py-3 rounded-lg btn-futuristic shadow-lg transition-all"
          >
            Register
          </button>
        </form>
        <div className="text-center mt-4">
          <span className="text-gray-300">Already have an account?</span>
          <button
            className="ml-2 text-cyan-400 hover:text-cyan-300 transition-colors"
            onClick={() => navigate("/login")}
          >
            Login
          </button>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
