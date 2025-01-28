const { useState, useEffect, useSyncExternalStore } = React;

function FullscreenModal({ isOpen, onClose, artifact }) {
  const containerRef = React.useRef();
  const [mountError, setMountError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    
    let mounted = true;
    let shadow = null;
    let cleanup = () => {};
    let sceneCleanup = null;

    const initializePhysics = () => {
      try {
        if (!containerRef.current || !mounted) return;
        
        const sandbox = containerRef.current.querySelector('.physics-content');
        if (!sandbox) {
          throw new Error('Could not find physics content container');
        }

        if (sandbox.shadowRoot) {
          sandbox.shadowRoot.innerHTML = '';
        } else {
          shadow = sandbox.attachShadow({ mode: 'open' });
        }

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center;';
        shadow.appendChild(wrapper);

        const styleElement = document.createElement('style');
        styleElement.textContent = `
          :host {
            all: initial;
            display: flex;
            position: relative;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
            contain: content;
          }
          ${artifact.code.css || ''}
          
          /* Ensure Three.js canvas fills container */
          canvas {
            width: 100% !important;
            height: 100% !important;
          }
          
          /* For 2D content */
          div {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        `;
        shadow.appendChild(styleElement);

        wrapper.innerHTML = artifact.code.html || '';

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
            log: (...args) => console.log(`[Physics ${artifact.id} Fullscreen]:`, ...args),
            error: (...args) => console.error(`[Physics ${artifact.id} Fullscreen]:`, ...args),
            warn: (...args) => console.warn(`[Physics ${artifact.id} Fullscreen]:`, ...args),
          },
          Math: Object.create(Math),
          THREE: window.THREE,
          initThreeScene: () => {
            const scene = new THREE.Scene();
            const camera = new THREE.PerspectiveCamera(
              75,
              wrapper.clientWidth / wrapper.clientHeight,
              0.1,
              1000
            );
            
            const renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
            wrapper.appendChild(renderer.domElement);
            
            const controls = new THREE.OrbitControls(camera, renderer.domElement);
            
            // Handle fullscreen resize
            const handleResize = () => {
              const width = wrapper.clientWidth;
              const height = wrapper.clientHeight;
              camera.aspect = width / height;
              camera.updateProjectionMatrix();
              renderer.setSize(width, height, false);
            };
            
            window.addEventListener('resize', handleResize);
            
            // Store cleanup for Three.js scene
            sceneCleanup = () => {
              window.removeEventListener('resize', handleResize);
              controls.dispose();
              renderer.dispose();
              if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
              }
            };
            
            return {
              scene,
              camera,
              renderer,
              controls,
              dispose: sceneCleanup
            };
          },
          loaders: {
            GLTFLoader: THREE.GLTFLoader,
          }
        };

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
              console.error(`[Physics ${artifact.id} Fullscreen] Animation error:`, e);
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
              console.error(`[Physics ${artifact.id} Fullscreen] Timeout error:`, e);
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
              console.error(`[Physics ${artifact.id} Fullscreen] Interval error:`, e);
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
          if (sceneCleanup) sceneCleanup();
          animations.clear();
          timers.clear();
          intervals.clear();
          if (shadow) {
            shadow.innerHTML = '';
          }
        };

        const code = `
          with (sandbox) {
            try {
              ${artifact.code.js || ''}
            } catch (error) {
              console.error('[Physics ${artifact.id} Fullscreen] Runtime error:', error);
            }
          }
        `;
        
        (new Function('sandbox', code))(sandboxEnvironment);

      } catch (error) {
        console.error(`[Physics ${artifact.id} Fullscreen] Initialization error:`, error);
        setMountError(error.message);
      }
    };

    const initTimer = setTimeout(initializePhysics, 100);

    // Add resize observer to handle container size changes
    const resizeObserver = new ResizeObserver(() => {
      if (mounted) {
        cleanup();
        initializePhysics();
      }
    });
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current.querySelector('.physics-content'));
    }

    return () => {
      cleanup();
      clearTimeout(initTimer);
      resizeObserver.disconnect();
    };
  }, [isOpen, artifact]);

  if (!isOpen) return null;

  return (
    <div className={`fullscreen-modal ${isOpen ? 'active' : ''}`}>
      <div className="fullscreen-content" ref={containerRef}>
        <div className="fullscreen-header">
          <div className="fullscreen-title">{artifact.code.title}</div>
          <button className="fullscreen-close" onClick={onClose}>&times;</button>
        </div>
        <div className="fullscreen-body">
          <div className="physics-content">
            {mountError && (
              <div className="error">
                Failed to load physics simulation: {mountError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IterateModal({ isOpen, onClose, artifact }) {
  const [suggestions, setSuggestions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const room = new WebsimSocket();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const basePrompt = `Improve and iterate on this existing physics demonstration. Make it more detailed, more interactive, or add new features while maintaining its core concept.

Original demonstration:
Title: ${artifact.code.title}
Description: ${artifact.code.description}
Original Prompt: ${artifact.prompt}
${suggestions ? `User suggestions: ${suggestions}` : 'Make it better/more detailed to the best of your ability'}

The response must be valid JSON matching this interface:

interface PhysicsArtifact {
  html: string;
  css: string;
  js: string;
  title: string;
  description: string;
}`;

      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: basePrompt,
          data: artifact.code,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

      // Create the new iteration with explicit reference to the parent
      const newArtifact = await room.collection('physics_artifact').create({
        prompt: `[Iteration] ${artifact.prompt}${suggestions ? ` with suggestions: ${suggestions}` : ''}`,
        code: artifactCode,
        title: artifactCode.title,
        description: artifactCode.description,
        iteration_of: artifact.id, // Explicitly set the parent reference
      });

      onClose();
    } catch (error) {
      console.error('Error creating iteration:', error);
      alert('Failed to create iteration. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className={`iterate-modal ${isOpen ? 'active' : ''}`}>
      <div className="iterate-content">
        <div className="iterate-header">
          <div className="iterate-title">Iterate on "{artifact.code.title}"</div>
          <button className="iterate-close" onClick={onClose}>&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="iterate-form">
          <textarea
            className="iterate-input"
            value={suggestions}
            onChange={(e) => setSuggestions(e.target.value)}
            placeholder="Optional: Add your suggestions for improvements, or leave blank to let AI enhance it automatically..."
          />
          <div className="iterate-buttons">
            <button 
              type="button" 
              className="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Creating...' : 'Create Iteration'}
            </button>
          </div>
        </form>
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isIterateModalOpen, setIsIterateModalOpen] = useState(false);
  const [iterationCount, setIterationCount] = useState(0);
  
  useEffect(() => {
    const countIterations = async () => {
      try {
        // Get all artifacts that are iterations of this artifact or in its ancestry chain
        const allArtifacts = await room.collection('physics_artifact').getList();
        const iterationChain = new Set();
        let currentId = artifact.id;
        
        // Keep track of visited IDs to prevent infinite loops
        const visited = new Set();

        // Build the full iteration chain from current artifact back to the original
        while (currentId && !visited.has(currentId)) {
          visited.add(currentId);
          iterationChain.add(currentId);
          
          // Find the current artifact in our list
          const current = allArtifacts.find(a => a.id === currentId);
          if (current && current.iteration_of) {
            currentId = current.iteration_of;
          } else {
            break;
          }
        }

        // Find all artifacts that are iterations of any artifact in our chain
        for (const chainId of iterationChain) {
          const children = allArtifacts.filter(a => a.iteration_of === chainId);
          children.forEach(child => iterationChain.add(child.id));
        }

        // Convert to array and sort by creation date to get the proper sequence
        const chainArray = Array.from(iterationChain)
          .map(id => allArtifacts.find(a => a.id === id))
          .filter(a => a) // Remove any undefined entries
          .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

        // Find the index of our current artifact in the sequence
        const position = chainArray.findIndex(a => a.id === artifact.id);
        
        // Add 1 since we want to display iteration numbers starting from 1
        setIterationCount(position + 1);
      } catch (error) {
        console.error('Error counting iterations:', error);
        setIterationCount(1); // Fallback to 1 if there's an error
      }
    };

    countIterations();
  }, [artifact, room]);

  const handleDelete = async (e) => {
    e.preventDefault();  
    e.stopPropagation(); 
    
    if (isDeleting) return; 
    
    if (!window.confirm('Are you sure you want to delete this physics artifact?')) {
      return;
    }
    
    setIsDeleting(true);
    try {
      await room.collection('physics_artifact').delete(artifact.id);
    } catch (error) {
      console.error('Failed to delete artifact:', error);
      alert('Failed to delete artifact. Please try again.');
      setIsDeleting(false);
    }
  };

  const handleFullscreen = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsFullscreen(true);
  };

  const handleIterate = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsIterateModalOpen(true);
  };

  useEffect(() => {
    let mounted = true;
    let shadow = null;
    let cleanup = () => {};
    let sceneCleanup = null;
    let resizeObserver = null;

    const initializePhysics = () => {
      try {
        if (!containerRef.current || !mounted) return;
        
        const sandbox = containerRef.current.querySelector('.physics-content');
        if (!sandbox) {
          throw new Error('Could not find physics content container');
        }

        // Clear existing shadow root content if it exists
        if (sandbox.shadowRoot) {
          sandbox.shadowRoot.innerHTML = '';
        } else {
          shadow = sandbox.attachShadow({ mode: 'open' });
        }

        const wrapper = document.createElement('div');
        wrapper.style.cssText = 'width: 100%; height: 100%; position: relative; display: flex; align-items: center; justify-content: center;';
        shadow.appendChild(wrapper);

        const styleElement = document.createElement('style');
        styleElement.textContent = `
          :host {
            all: initial;
            display: flex;
            position: relative;
            width: 100%;
            height: 100%;
            align-items: center;
            justify-content: center;
            contain: content;
            background: #f8f9fa;
            border-radius: 8px;
            overflow: hidden;
          }
          ${artifact.code.css || ''}
          
          /* Ensure Three.js canvas fits properly */
          canvas {
            width: 100% !important;
            height: 100% !important;
            outline: none;
          }
          
          /* For 2D content */
          div {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
          }
        `;
        shadow.appendChild(styleElement);

        wrapper.innerHTML = artifact.code.html || '';

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
          THREE: window.THREE,
          initThreeScene: () => {
            const scene = new THREE.Scene();
            scene.background = new THREE.Color(0xf8f9fa);
            
            const aspectRatio = wrapper.clientWidth / wrapper.clientHeight;
            const camera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 1000);
            camera.position.set(4, 4, 4);
            camera.lookAt(0, 0, 0);
            
            const renderer = new THREE.WebGLRenderer({ 
              antialias: true,
              alpha: true,
              preserveDrawingBuffer: true
            });
            renderer.setPixelRatio(window.devicePixelRatio);
            renderer.setSize(wrapper.clientWidth, wrapper.clientHeight);
            renderer.shadowMap.enabled = true;
            renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            wrapper.appendChild(renderer.domElement);
            
            // Add better lighting setup
            const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
            scene.add(ambientLight);
            
            const mainLight = new THREE.DirectionalLight(0xffffff, 0.8);
            mainLight.position.set(5, 5, 5);
            mainLight.castShadow = true;
            mainLight.shadow.mapSize.width = 1024;
            mainLight.shadow.mapSize.height = 1024;
            scene.add(mainLight);
            
            const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
            fillLight.position.set(-5, 0, -5);
            scene.add(fillLight);
            
            const controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = true;
            controls.enableZoom = true;
            controls.autoRotate = true; // Auto-rotate for preview
            controls.autoRotateSpeed = 1;
            
            // Add a subtle grid for better spatial reference
            const gridHelper = new THREE.GridHelper(10, 10, 0xcccccc, 0xeeeeee);
            gridHelper.material.opacity = 0.2;
            gridHelper.material.transparent = true;
            scene.add(gridHelper);
            
            // Handle resize
            let resizeTimeout = null;
            const handleResize = () => {
              if (resizeTimeout) {
                clearTimeout(resizeTimeout);
              }
              resizeTimeout = setTimeout(() => {
                if (!mounted) return;
                const width = wrapper.clientWidth;
                const height = wrapper.clientHeight;
                camera.aspect = width / height;
                camera.updateProjectionMatrix();
                renderer.setSize(width, height, false);
              }, 100);
            };
            
            // Create ResizeObserver with debounced callback
            resizeObserver = new ResizeObserver((entries) => {
              if (!mounted) return;
              handleResize();
            });
            
            resizeObserver.observe(wrapper);
            
            let animationFrameId = null;
            
            function animate() {
              if (!mounted) return;
              animationFrameId = requestAnimationFrame(animate);
              controls.update();
              renderer.render(scene, camera);
            }
            animate();
            
            sceneCleanup = () => {
              if (animationFrameId) {
                cancelAnimationFrame(animationFrameId);
              }
              if (resizeTimeout) {
                clearTimeout(resizeTimeout);
              }
              if (resizeObserver) {
                resizeObserver.disconnect();
              }
              controls.dispose();
              renderer.dispose();
              if (renderer.domElement && renderer.domElement.parentNode) {
                renderer.domElement.parentNode.removeChild(renderer.domElement);
              }
            };
            
            return {
              scene,
              camera,
              renderer,
              controls,
              dispose: sceneCleanup
            };
          },
          loaders: {
            GLTFLoader: THREE.GLTFLoader,
          }
        };

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
          if (sceneCleanup) sceneCleanup();
          if (resizeObserver) {
            resizeObserver.disconnect();
          }
          if (shadow) {
            shadow.innerHTML = '';
          }
          animations.clear();
          timers.clear();
          intervals.clear();
        };

        const code = `
          with (sandbox) {
            try {
              ${artifact.code.js || ''}
            } catch (error) {
              console.error('[Physics ${artifact.id}] Runtime error:', error);
            }
          }
        `;
        
        (new Function('sandbox', code))(sandboxEnvironment);

      } catch (error) {
        console.error(`[Physics ${artifact.id}] Initialization error:`, error);
        setMountError(error.message);
      }
    };

    const initTimer = setTimeout(initializePhysics, 100);

    return () => {
      mounted = false;
      cleanup();
      clearTimeout(initTimer);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [artifact.id, artifact.code]);

  const isOwner = artifact.username === room.party.client.username;

  return (
    <>
      <div className="physics-container" ref={containerRef}>
        {isOwner && (
          <button 
            className="delete-button" 
            onClick={handleDelete}
            disabled={isDeleting}
            title="Delete this artifact"
            type="button"
          >
            ×
          </button>
        )}
        <button 
          className="iterate-button" 
          onClick={handleIterate}
          title="Iterate and improve"
          type="button"
        >
          ↻
        </button>
        <button 
          className="fullscreen-button" 
          onClick={handleFullscreen}
          title="View fullscreen"
          type="button"
        >
          ⤢
        </button>
        <div className="iteration-badge" title={`Iteration #${iterationCount}`}>
          {iterationCount}
        </div>
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
      <FullscreenModal 
        isOpen={isFullscreen}
        onClose={() => setIsFullscreen(false)}
        artifact={artifact}
      />
      <IterateModal
        isOpen={isIterateModalOpen}
        onClose={() => setIsIterateModalOpen(false)}
        artifact={artifact}
      />
    </>
  );
}

function PhysicsPlayground() {
  const [prompt, setPrompt] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const room = new WebsimSocket();
  
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
      const response = await fetch('/api/ai_completion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          prompt: `Create an interactive physics demonstration or simulation based on the following prompt. 
          You have access to Three.js for 3D graphics and physics simulations. The Three.js library and its common addons (OrbitControls, GLTFLoader) are already loaded.
          
          You can initialize a Three.js scene using the provided initThreeScene() helper:
          const { scene, camera, renderer, controls, dispose } = initThreeScene();
          
          The response must be valid JSON matching this interface:

          interface PhysicsArtifact {
            html: string;      // The HTML code for the demonstration
            css: string;       // The CSS styles for the demonstration
            js: string;        // The JavaScript code for the demonstration
            title: string;     // A short title describing the demonstration
            description: string; // A longer description explaining the physics concept
          }

          Example Three.js usage:
          {
            "html": "<div class='scene-container'></div>",
            "css": ".scene-container { width: 100%; height: 100%; }",
            "js": "const { scene, camera, renderer, controls } = initThreeScene();
                  camera.position.z = 5;
                  const geometry = new THREE.BoxGeometry();
                  const material = new THREE.MeshPhongMaterial({ color: 0x00ff00 });
                  const cube = new THREE.Mesh(geometry, material);
                  scene.add(cube);
                  
                  function animate() {
                    requestAnimationFrame(animate);
                    cube.rotation.x += 0.01;
                    cube.rotation.y += 0.01;
                    renderer.render(scene, camera);
                  }
                  animate();",
            "title": "Rotating 3D Cube",
            "description": "A simple demonstration of 3D graphics using Three.js"
          }

          The code should leverage Three.js for 3D graphics and physics where appropriate.
          Ensure all code is properly escaped for JSON.
          
          Create a physics demonstration for: ${prompt}`,
          data: prompt
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const artifactCode = await response.json();
      
      if (!artifactCode.html || !artifactCode.css || !artifactCode.js || !artifactCode.title || !artifactCode.description) {
        throw new Error('Invalid response format from AI');
      }

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

ReactDOM.render(<PhysicsPlayground />, document.getElementById('root'));