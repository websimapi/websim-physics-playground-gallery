const { useState, useEffect, useSyncExternalStore } = React;

function PhysicsPlayground() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const room = new WebsimSocket();
  
  // Get physics artifacts from the database
  const artifacts = useSyncExternalStore(
    room.collection('physics_artifact').subscribe,
    () => room.collection('physics_artifact').getList()
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    
    setIsSubmitting(true);
    setError(null);

    try {
      // Get AI response for physics simulation
      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Create an interactive physics demonstration or simulation based on the following prompt. 
          The response should be valid JSON containing HTML, CSS, and JavaScript code that demonstrates the physics concept.
          The JavaScript code should be written to work within a setup function.
          
          interface Response {
            html: string;
            css: string;
            js: string;
            title: string;
            description: string;
          }
          
          Example response:
          {
            "html": "<div class='simulation'><svg viewBox='0 0 400 300'><circle cx='200' cy='150' r='20' class='ball'></circle></svg></div>",
            "css": ".simulation { width: 100%; height: 100%; } .ball { fill: blue; }",
            "js": "let ball = container.querySelector('.ball'); let velocity = 0; function animate() { velocity += 0.5; let cy = parseFloat(ball.getAttribute('cy')); ball.setAttribute('cy', cy + velocity); if (cy > 280) { velocity = -velocity * 0.8; } requestAnimationFrame(animate); } animate();",
            "title": "Bouncing Ball",
            "description": "Simple gravity simulation with a bouncing ball"
          }

          Make the response a valid JSON object matching the interface above.
          The code should be self-contained and use SVG for graphics where possible.
          All JavaScript code should be executable when passed into the setup function scope.
          Avoid using 'let' or 'const' declarations at the top level - all variables should be declared inside functions.
          
          Prompt: ${prompt}`,
          data: prompt
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      // Validate the response has the required fields
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

      // Store the artifact in the database
      await room.collection('physics_artifact').create({
        prompt,
        code: artifactCode,
        title: artifactCode.title,
        description: artifactCode.description
      });

      setPrompt('');
    } catch (err) {
      console.error('Error details:', err);
      setError('Failed to create physics simulation. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="container">
      <div className="input-section">
        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe a physics concept or experiment..."
              disabled={isSubmitting}
            />
            <button type="submit" disabled={isSubmitting || !prompt.trim()}>
              {isSubmitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="gallery">
        {artifacts.length === 0 ? (
          <div className="loading">No physics simulations yet. Create the first one!</div>
        ) : (
          artifacts
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .map(artifact => (
              <PhysicsContainer key={artifact.id} artifact={artifact} />
            ))
        )}
      </div>
    </div>
  );
}

function PhysicsContainer({ artifact }) {
  const containerRef = React.useRef();

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const sandbox = container.querySelector('.physics-content');
    
    try {
      // Clear previous content
      sandbox.innerHTML = '';
      
      // Create a style element
      const style = document.createElement('style');
      style.textContent = artifact.code.css;
      
      // Create the HTML content wrapper
      const content = document.createElement('div');
      content.innerHTML = artifact.code.html;
      
      // Append style and content
      sandbox.appendChild(style);
      sandbox.appendChild(content);
      
      // Create and execute the physics code
      const setupFunction = new Function('container', artifact.code.js);
      setupFunction(sandbox);
      
    } catch (error) {
      console.error('Error setting up physics container:', error);
      sandbox.innerHTML = '<div class="error">Error loading simulation</div>';
    }

    // Cleanup function
    return () => {
      if (sandbox) {
        sandbox.innerHTML = '';
      }
    };
  }, [artifact]);

  return (
    <div className="physics-container" ref={containerRef}>
      <div className="physics-container-header">
        <h3>{artifact.code.title}</h3>
        <p>{artifact.code.description}</p>
      </div>
      <div className="physics-content"></div>
      <div className="physics-meta">
        <img 
          className="avatar"
          src={`https://images.websim.ai/avatar/${artifact.username}`}
          alt={artifact.username}
        />
        <span>{artifact.username}</span>
        <span>•</span>
        <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

ReactDOM.render(<PhysicsPlayground />, document.getElementById('root'));