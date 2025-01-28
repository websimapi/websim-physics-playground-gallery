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
          Respond with HTML, CSS, and JavaScript code that demonstrates the physics concept.
          The code should be self-contained and use SVG for graphics where possible.
          
          Prompt: ${prompt}`,
          data: prompt
        }),
      });

      const artifactCode = await response.json();
      
      // Store the artifact in the database
      await room.collection('physics_artifact').create({
        prompt,
        code: artifactCode,
        title: artifactCode.title,
        description: artifactCode.description
      });

      setPrompt('');
    } catch (err) {
      setError('Failed to create physics simulation. Please try again.');
      console.error(err);
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
        {artifacts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).map(artifact => (
          <PhysicsContainer key={artifact.id} artifact={artifact} />
        ))}
      </div>
    </div>
  );
}

function PhysicsContainer({ artifact }) {
  const containerRef = React.useRef();
  const room = new WebsimSocket();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleDelete = async () => {
    if (!window.confirm('Are you sure you want to delete this physics artifact?')) return;
    
    setIsDeleting(true);
    try {
      await room.collection('physics_artifact').delete(artifact.id);
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      alert('Failed to delete artifact. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  // Check if the current user is the creator of this artifact
  const isOwner = artifact.username === room.party.client.username;

  useEffect(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const sandbox = container.querySelector('.physics-content');
    
    // Create a safe sandbox for the physics simulation
    sandbox.innerHTML = artifact.code.html;
    
    // Add styles
    const style = document.createElement('style');
    style.textContent = artifact.code.css;
    sandbox.appendChild(style);
    
    // Add and execute JavaScript
    const script = document.createElement('script');
    script.textContent = artifact.code.js;
    sandbox.appendChild(script);

    return () => {
      sandbox.innerHTML = '';
    };
  }, [artifact]);

  const toggleDetails = () => {
    setIsExpanded(!isExpanded);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="physics-container" ref={containerRef}>
      {isOwner && (
        <button 
          className="delete-button" 
          onClick={handleDelete}
          disabled={isDeleting}
          title="Delete this artifact"
        >
          ×
        </button>
      )}
      <div className="physics-content"></div>
      <div 
        className={`physics-meta ${isExpanded ? 'expanded' : ''}`}
        onClick={toggleDetails}
      >
        <img 
          className="avatar"
          src={`https://images.websim.ai/avatar/${artifact.username}`}
          alt={artifact.username}
        />
        <span>{artifact.username}</span>
        <span>•</span>
        <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
      </div>
      <div className={`details-panel ${isExpanded ? 'expanded' : ''}`}>
        <div className="details-content">
          <div className="details-row">
            <div className="details-label">Title</div>
            <div className="details-value">{artifact.title}</div>
          </div>
          <div className="details-row">
            <div className="details-label">Description</div>
            <div className="details-value">{artifact.description}</div>
          </div>
          <div className="details-row">
            <div className="details-label">Original Prompt</div>
            <div className="details-value">{artifact.prompt}</div>
          </div>
          <div className="details-row">
            <div className="details-label">Created At</div>
            <div className="details-value">{formatDate(artifact.created_at)}</div>
          </div>
          <div className="details-row">
            <div className="details-label">Source Code</div>
            <div className="details-value">
              <pre>HTML:{'\n'}{artifact.code.html}</pre>
              <pre>CSS:{'\n'}{artifact.code.css}</pre>
              <pre>JavaScript:{'\n'}{artifact.code.js}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<PhysicsPlayground />, document.getElementById('root'));