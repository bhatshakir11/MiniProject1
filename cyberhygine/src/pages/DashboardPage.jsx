import React, { useEffect, useState } from "react";
import Navbar from "../components/Navbar";
import AnimatedBackground from "../components/AnimatedBackground";
import axios from "axios";
import API_BASE_URL from "../config";
import { PieChart, Pie, Cell, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Legend } from "recharts";

const STRENGTH_COLORS = {
  Strong: "#00C49F",
  Medium: "#FFD600",
  Weak: "#FF8042",
};

const DashboardPage = () => {
  const [stats, setStats] = useState({ strong: 0, weak: 0, medium: 0, score: 0, reused: 0, unique: 0 });
  const [credentials, setCredentials] = useState([]);

  useEffect(() => {
    const fetchStats = () => {
      axios.get(`${API_BASE_URL}/dashboard`).then(res => {
        setStats(res.data);
      });
      axios.get(`${API_BASE_URL}/credentials`).then(res => {
        setCredentials(res.data);
      });
    };
    fetchStats();
    const interval = setInterval(fetchStats, 2000); // Poll every 2s for real-time updates
    return () => clearInterval(interval);
  }, []);

  const hygieneScore = stats.score;
  const passwordStats = [
    { name: "Strong", value: stats.strong },
    { name: "Medium", value: stats.medium },
    { name: "Weak", value: stats.weak },
  ];
  const reusedStats = [
    { name: "Reused", value: stats.reused },
    { name: "Unique", value: stats.unique },
  ];
  const COLORS = ["#00C49F", "#FF8042", "#FFD600"];

  // Generate real-time reminders and tips
  const reminders = [];
  const passwordMap = {};
  credentials.forEach(cred => {
    // Check for reused passwords
    if (passwordMap[cred.password]) {
      passwordMap[cred.password].push(cred.site);
    } else {
      passwordMap[cred.password] = [cred.site];
    }
    // Weak password alert
    if (cred.strength === "weak") {
      reminders.push(`Weak password detected for ${cred.site}`);
    }
  });
  Object.entries(passwordMap).forEach(([pwd, sites]) => {
    if (sites.length > 1) {
      reminders.push(`Password reused for: ${sites.join(", ")}`);
    }
  });
  if (reminders.length === 0) {
    reminders.push("All your passwords are strong and unique! Great job!");
  }

  // Real-time tips
  const tips = [];
  if (stats.weak > 0) tips.push("Consider updating weak passwords to stronger ones.");
  if (stats.reused > 0) tips.push("Avoid reusing passwords across sites.");
  if (stats.strong === 0) tips.push("Try to use strong passwords for all accounts.");
  if (tips.length === 0) tips.push("Your vault is in excellent shape!");

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900">
      <AnimatedBackground />
      <Navbar />
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8 relative z-10">
        <h2 className="text-4xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent mb-8 animate-fade-in">Dashboard</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
          <div className="glass-card rounded-2xl p-6 text-center animate-fade-in" style={{animationDelay: '0.1s'}}>
            <h3 className="text-lg font-semibold text-cyan-300 mb-4">Cyber Hygiene Score</h3>
            <div className="flex flex-col items-center">
              <PieChart width={180} height={180}>
                <Pie
                  data={[{ name: "Score", value: hygieneScore }, { name: "Rest", value: 100 - hygieneScore }]}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  startAngle={90}
                  endAngle={-270}
                  dataKey="value"
                >
                  <Cell key="score" fill="#00C49F" />
                  <Cell key="rest" fill="#22223b" />
                </Pie>
              </PieChart>
              <span className="text-4xl font-bold bg-gradient-to-r from-green-400 to-cyan-400 bg-clip-text text-transparent mt-2">{hygieneScore}%</span>
            </div>
          </div>
          <div className="glass-card rounded-2xl p-6 animate-fade-in" style={{animationDelay: '0.2s'}}>
            <h3 className="text-lg font-semibold text-cyan-300 mb-4">Password Strength</h3>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={passwordStats}>
                <XAxis dataKey="name" stroke="#fff" />
                <YAxis stroke="#fff" />
                <Tooltip />
                <Legend />
                <Bar dataKey="value">
                  {passwordStats.map((entry, idx) => (
                    <Cell key={`cell-bar-${idx}`} fill={STRENGTH_COLORS[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 mt-6 lg:mt-8">
          <div className="glass-card rounded-2xl p-6 animate-fade-in" style={{animationDelay: '0.3s'}}>
            <h3 className="text-lg font-semibold text-cyan-300 mb-4">Reused vs Unique Passwords</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie
                  data={reusedStats}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label
                >
                  {reusedStats.map((entry, idx) => (
                    <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="glass-card rounded-2xl p-6 flex flex-col justify-center animate-fade-in" style={{animationDelay: '0.4s'}}>
            <h3 className="text-lg font-semibold text-cyan-300 mb-4">Reminders & Alerts</h3>
            <ul className="text-gray-200 mb-4 space-y-2">
              {reminders.map((rem, idx) => (
                <li key={idx} className="flex items-start"><span className="text-cyan-400 mr-2">•</span>{rem}</li>
              ))}
            </ul>
            <h4 className="text-md font-semibold text-cyan-300 mb-2 mt-4">Tips:</h4>
            <ul className="text-gray-300 space-y-2">
              {tips.map((tip, idx) => (
                <li key={idx} className="flex items-start"><span className="text-blue-400 mr-2">→</span>{tip}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
