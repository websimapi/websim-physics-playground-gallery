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
          The response must be valid JSON matching this interface:

          interface PhysicsArtifact {
            html: string;      // The HTML code for the demonstration
            css: string;       // The CSS styles for the demonstration
            js: string;        // The JavaScript code for the demonstration
            title: string;     // A short title describing the demonstration
            description: string; // A longer description explaining the physics concept
          }

          {
            "html": "<div class='container'><svg width='300' height='200'>...</svg></div>",
            "css": ".container { ... }",
            "js": "const svg = document.querySelector('svg'); ...",
            "title": "Simple Pendulum Simulation",
            "description": "This demonstration shows a pendulum swinging under the influence of gravity..."
          }

          The code should be self-contained and use SVG for graphics where possible.
          Ensure all code is properly escaped for JSON.
          
          Create a physics demonstration for: ${prompt}`,
          data: prompt
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      // Validate the response has all required fields
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
      setError('Failed to create physics simulation. Please try again with a different prompt.');
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
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [mountError, setMountError] = useState(null);
  const sandboxId = `physics-sandbox-${artifact.id}`;

  useEffect(() => {
    let cleanup = () => {};
    let shadow = null;
    
    const initializePhysics = () => {
      try {
        if (!containerRef.current) return;

        const container = containerRef.current;
        const sandbox = container.querySelector('.physics-content');
        
        if (!sandbox) {
          throw new Error('Could not find physics content container');
        }

        // Remove any existing shadow root
        if (sandbox.shadowRoot) {
          cleanup();
          sandbox.innerHTML = '';
        }

        // Create new shadow root
        shadow = sandbox.attachShadow({ mode: 'open' });
        
        // Create and setup the physics container
        const physicsContainer = document.createElement('div');
        physicsContainer.id = sandboxId;
        physicsContainer.innerHTML = artifact.code.html || '';
        
        // Add styles
        const style = document.createElement('style');
        style.textContent = `
          :host {
            all: initial;
            display: block;
            position: relative;
            width: 100%;
            height: 100%;
            contain: content;
          }
          div {
            position: relative;
            max-width: 100%;
          }
          ${artifact.code.css || ''}
        `;
        
        shadow.appendChild(style);
        shadow.appendChild(physicsContainer);
        
        // Create isolated script context
        const scriptContent = `
          (() => {
            try {
              // Get container reference safely
              const container = document.getElementById('${sandboxId}');
              if (!container) throw new Error('Container not found');
              
              // Track animation frames and timeouts
              const activeAnimationFrames = new Set();
              const activeTimeouts = new Set();
              
              // Create sandbox environment
              const sandbox = {
                console: {
                  log: (...args) => console.log('[Physics ${artifact.id}]:', ...args),
                  error: (...args) => console.error('[Physics ${artifact.id}]:', ...args),
                  warn: (...args) => console.warn('[Physics ${artifact.id}]:', ...args)
                },
                container,
                getElement: (selector) => container.querySelector(selector),
                getElements: (selector) => container.querySelectorAll(selector),
                requestAnimationFrame: (cb) => {
                  const id = window.requestAnimationFrame((timestamp) => {
                    activeAnimationFrames.delete(id);
                    try {
                      cb(timestamp);
                    } catch (e) {
                      console.error('[Physics ${artifact.id}] Animation error:', e);
                    }
                  });
                  activeAnimationFrames.add(id);
                  return id;
                },
                cancelAnimationFrame: (id) => {
                  activeAnimationFrames.delete(id);
                  window.cancelAnimationFrame(id);
                },
                setTimeout: (cb, delay) => {
                  const id = window.setTimeout(() => {
                    activeTimeouts.delete(id);
                    try {
                      cb();
                    } catch (e) {
                      console.error('[Physics ${artifact.id}] Timeout error:', e);
                    }
                  }, delay);
                  activeTimeouts.add(id);
                  return id;
                },
                clearTimeout: (id) => {
                  activeTimeouts.delete(id);
                  window.clearTimeout(id);
                },
                Math: Object.create(Math)
              };

              // Store cleanup function
              container.cleanup = () => {
                activeAnimationFrames.forEach(id => window.cancelAnimationFrame(id));
                activeTimeouts.forEach(id => window.clearTimeout(id));
                activeAnimationFrames.clear();
                activeTimeouts.clear();
              };

              // Run physics code in sandbox
              with (sandbox) {
                ${artifact.code.js || ''}
              }
            } catch (error) {
              console.error('[Physics ${artifact.id}] Initialization error:', error);
            }
          })();
        `;

        const script = document.createElement('script');
        script.textContent = scriptContent;
        shadow.appendChild(script);

        cleanup = () => {
          try {
            if (shadow) {
              const container = shadow.getElementById(sandboxId);
              if (container && container.cleanup) {
                container.cleanup();
              }
              
              // Remove all children from shadow root
              while (shadow.firstChild) {
                shadow.removeChild(shadow.firstChild);
              }
            }
          } catch (e) {
            console.warn('[Physics ${artifact.id}] Cleanup error:', e);
          }
        };
      } catch (error) {
        console.error('[Physics ${artifact.id}] Mount error:', error);
        setMountError(error.message);
      }
    };

    // Initialize physics with a small delay to ensure DOM is ready
    const initTimer = setTimeout(initializePhysics, 0);

    return () => {
      clearTimeout(initTimer);
      cleanup();
    };
  }, [artifact.id, artifact.code]);

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

  const isOwner = artifact.username === room.party.client.username;

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('default', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
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
      <div className="physics-content">
        {mountError && (
          <div className="error">
            Failed to load physics simulation: {mountError}
          </div>
        )}
      </div>
      <div className="physics-meta">
        <img 
          className="avatar"
          src={`https://images.websim.ai/avatar/${artifact.username}`}
          alt={artifact.username}
        />
        <span>{artifact.username}</span>
        <span>•</span>
        <span>{new Date(artifact.created_at).toLocaleDateString()}</span>
        <button 
          className="details-toggle" 
          onClick={() => setIsDetailsOpen(!isDetailsOpen)}
        >
          Details
          <span className={`chevron ${isDetailsOpen ? 'open' : ''}`}>▼</span>
        </button>
      </div>
      <div className={`details-dropdown ${isDetailsOpen ? 'open' : 'closed'}`}>
        <div className="details-section">
          <div className="details-label">Title</div>
          <div className="details-value">{artifact.code.title}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Description</div>
          <div className="details-value">{artifact.code.description}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Original Prompt</div>
          <div className="details-value">{artifact.prompt}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Created</div>
          <div className="details-value">{formatDate(artifact.created_at)}</div>
        </div>
        <div className="details-section">
          <div className="details-label">Created By</div>
          <div className="details-value">{artifact.username}</div>
        </div>
      </div>
    </div>
  );
}

ReactDOM.render(<PhysicsPlayground />, document.getElementById('root'));