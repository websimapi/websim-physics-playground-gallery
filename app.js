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
  
  useEffect(() => {
    let mounted = true;
    let shadow = null;
    let cleanup = () => {};

    const initializePhysics = () => {
      try {
        if (!containerRef.current || !mounted) return;
        
        // Get the physics content container
        const sandbox = containerRef.current.querySelector('.physics-content');
        if (!sandbox) {
          throw new Error('Could not find physics content container');
        }

        // Clear any existing content and shadow root
        if (sandbox.shadowRoot) {
          sandbox.shadowRoot.innerHTML = '';
        } else {
          shadow = sandbox.attachShadow({ mode: 'open' });
        }

        // Create wrapper element
        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 100%; position: relative;';
        shadow.appendChild(wrapper);

        // Add styles
        const styleElement = document.createElement('style');
        styleElement.textContent = `
          :host {
            all: initial;
            display: block;
            position: relative;
            width: 100%;
            height: 100%;
            contain: content;
          }
          ${artifact.code.css || ''}
        `;
        shadow.appendChild(styleElement);

        // Add HTML content
        wrapper.innerHTML = artifact.code.html || '';

        // Create a safe sandbox environment
        const sandboxEnvironment = {
          rootElement: wrapper,
          document: {
            getElementById: (id) => wrapper.querySelector('#' + id),
            querySelector: (sel) => wrapper.querySelector(sel),
            querySelectorAll: (sel) => wrapper.querySelectorAll(sel),
            createElement: (tag) => document.createElement(tag),
          },
          window: {
            innerWidth: wrapper.clientWidth,
            innerHeight: wrapper.clientHeight,
          },
          console: {
            log: (...args) => console.log(`[Physics ${artifact.id}]:`, ...args),
            error: (...args) => console.error(`[Physics ${artifact.id}]:`, ...args),
            warn: (...args) => console.warn(`[Physics ${artifact.id}]:`, ...args),
          },
          Math: Object.create(Math),
        };

        // Animation and timing management
        const animations = new Set();
        const timers = new Set();
        const intervals = new Set();

        sandboxEnvironment.requestAnimationFrame = (cb) => {
          const id = window.requestAnimationFrame((timestamp) => {
            if (!animations.has(id) || !mounted) return;
            animations.delete(id);
            try {
              cb(timestamp);
            } catch (e) {
              console.error(`[Physics ${artifact.id}] Animation error:`, e);
            }
          });
          animations.add(id);
          return id;
        };

        sandboxEnvironment.setTimeout = (cb, delay) => {
          const id = window.setTimeout(() => {
            if (!timers.has(id) || !mounted) return;
            timers.delete(id);
            try {
              cb();
            } catch (e) {
              console.error(`[Physics ${artifact.id}] Timeout error:`, e);
            }
          }, delay);
          timers.add(id);
          return id;
        };

        sandboxEnvironment.setInterval = (cb, delay) => {
          const id = window.setInterval(() => {
            if (!intervals.has(id) || !mounted) return;
            try {
              cb();
            } catch (e) {
              console.error(`[Physics ${artifact.id}] Interval error:`, e);
            }
          }, delay);
          intervals.add(id);
          return id;
        };

        cleanup = () => {
          mounted = false;
          animations.forEach(id => window.cancelAnimationFrame(id));
          timers.forEach(id => window.clearTimeout(id));
          intervals.forEach(id => window.clearInterval(id));
          animations.clear();
          timers.clear();
          intervals.clear();
          if (shadow) {
            shadow.innerHTML = '';
          }
        };

        // Execute the physics code in the sandbox
        const code = `
          with (sandbox) {
            try {
              ${artifact.code.js || ''}
            } catch (error) {
              console.error('[Physics ${artifact.id}] Runtime error:', error);
            }
          }
        `;

        const scriptElement = document.createElement('script');
        scriptElement.textContent = code;
        
        // Execute the code with the sandbox environment
        (new Function('sandbox', code))(sandboxEnvironment);

      } catch (error) {
        console.error(`[Physics ${artifact.id}] Initialization error:`, error);
        setMountError(error.message);
      }
    };

    // Initialize with a small delay to ensure DOM is ready
    const initTimer = setTimeout(initializePhysics, 100);

    return () => {
      cleanup();
      clearTimeout(initTimer);
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

  return (
    <div className="physics-container" ref={containerRef}>
      {isOwner && (
        <button 
          className="delete-button" 
          onClick={() => handleDelete(artifact.id)}
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
          <div className="details-value">
            {new Intl.DateTimeFormat('default', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit'
            }).format(new Date(artifact.created_at))}
          </div>
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