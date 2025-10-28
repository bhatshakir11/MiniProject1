import React from "react";

const AnimatedBackground = () => {

  const blobs = [
    { size: 300, color: "#00C49F", top: "10%", left: "10%", delay: 0, duration: 11 },
    { size: 250, color: "#4A90E2", top: "60%", left: "70%", delay: 2, duration: 14 },
    { size: 200, color: "#9B59B6", top: "30%", left: "80%", delay: 4, duration: 13 },
    { size: 280, color: "#FF8042", top: "70%", left: "20%", delay: 6, duration: 15 },
    { size: 220, color: "#FFD600", top: "50%", left: "50%", delay: 8, duration: 10 },
    { size: 260, color: "#E74C3C", top: "20%", left: "40%", delay: 10, duration: 14 },
    { size: 240, color: "#3498DB", top: "80%", left: "60%", delay: 12, duration: 13 },
    { size: 210, color: "#1ABC9C", top: "40%", left: "15%", delay: 14, duration: 11 },
    { size: 230, color: "#FF6B9D", top: "15%", left: "60%", delay: 1, duration: 13 },
    { size: 270, color: "#C44569", top: "55%", left: "30%", delay: 3, duration: 12 },
    { size: 190, color: "#FFA502", top: "75%", left: "80%", delay: 5, duration: 15 },
    { size: 250, color: "#26C6DA", top: "35%", left: "50%", delay: 7, duration: 11 },
  ];

  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", overflow: "hidden", zIndex: 0, pointerEvents: "none" }}>
      {blobs.map((blob, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            width: `${blob.size}px`,
            height: `${blob.size}px`,
            background: blob.color,
            top: blob.top,
            left: blob.left,
            borderRadius: "50%",
            filter: "blur(60px)",
            opacity: 0.3,
            animation: `paintFloat ${blob.duration}s infinite ease-in-out`,
            animationDelay: `${blob.delay}s`,
          }}
        />
      ))}
    </div>
  );
};

export default AnimatedBackground;
