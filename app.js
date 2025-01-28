// Replace ReactDOM.render with createRoot
const container = document.getElementById('root');
const root = ReactDOM.createRoot(container);
root.render(
  <React.StrictMode>
    <PhysicsPlayground />
  </React.StrictMode>
);