    // A visit keeps order stable through background refreshes; the device ID retains only
    // this visitor's preferences. The server hashes identity before storage.
    const discoveryVisitId = crypto.randomUUID();
    const discoveryBrowserId = (() => {
      try {
        let id = localStorage.getItem("mydancrDiscoveryViewerV1");
        if (!/^[a-f0-9-]{36}$/i.test(id || "")) { id = crypto.randomUUID(); localStorage.setItem("mydancrDiscoveryViewerV1", id); }
        return id;
      } catch { return discoveryVisitId; }
    })();
    const discoveryEventChains = new Map();
    const discoverySentEvents = new Set();
    const discoveryEventRetryAfter = new Map();
    let discoveryGridObserver = null;
    const discoveryGridTimers = new Map();
    function discoveryRequestHeaders() {
      return { "x-discovery-session": discoveryBrowserId, "x-discovery-visit": discoveryVisitId,
        ...(authSession?.accessToken ? { Authorization: `Bearer ${authSession.accessToken}` } : {}) };
    }
    function recordDiscoveryEvent(entityId, placement, event) {
      if (!entityId || !placement?.session || window.location.protocol === "file:") return Promise.resolve(false);
      const key = `${new Date().toISOString().slice(0,10)}:${placement.session}:${entityId}:${event}`;
      if ((discoveryEventRetryAfter.get(key) || 0)>Date.now()) return Promise.resolve(false);
      if (discoverySentEvents.has(key)) return discoveryEventChains.get(entityId) || Promise.resolve(true);
      discoverySentEvents.add(key);
      const chain = (discoveryEventChains.get(entityId) || Promise.resolve()).then(async () => {
        try {
          const response = await fetch("/api/public/discovery/events", { method:"POST", keepalive:true,
            headers:{...discoveryRequestHeaders(),"Content-Type":"application/json"},
            body:JSON.stringify({entityId,event,...placement}) });
          if (!response.ok) {
            discoverySentEvents.delete(key);
            discoveryEventRetryAfter.set(key,Date.now()+(response.status===429?60000:5000));
          }
          return response.ok;
        } catch { discoverySentEvents.delete(key); discoveryEventRetryAfter.set(key,Date.now()+5000); return false; }
      });
      discoveryEventChains.set(entityId,chain);
      return chain;
    }
    function discoveryCardPlacement(card) {
      return card?.dataset.discoverySession ? {session:card.dataset.discoverySession,position:Number(card.dataset.discoveryPosition),
        displayPosition:Math.max(0,[...results.querySelectorAll("[data-discovery-session][data-public-dancer-id]")].indexOf(card))} : null;
    }
    function discoveryCardAttributes(profile) {
      const placement = profile.discovery;
      return placement?.session ? ` data-discovery-session="${escapeOptionValue(placement.session)}" data-discovery-position="${Number(placement.position)}"` : "";
    }
    function observeDiscoveryGrid() {
      discoveryGridObserver?.disconnect();
      discoveryGridTimers.forEach(timer=>clearTimeout(timer)); discoveryGridTimers.clear();
      if (!("IntersectionObserver" in window)) return;
      discoveryGridObserver = new IntersectionObserver(entries=>{
        for (const entry of entries) {
          const card = entry.target;
          clearTimeout(discoveryGridTimers.get(card)); discoveryGridTimers.delete(card);
          if (!entry.isIntersecting || entry.intersectionRatio < .5) continue;
          discoveryGridTimers.set(card,setTimeout(()=>{
            discoveryGridTimers.delete(card);
            if (!card.isConnected || document.visibilityState!=="visible" || document.body.classList.contains("overlay-open")) return;
            void recordDiscoveryEvent(card.dataset.publicDancerId,discoveryCardPlacement(card),"impression");
          },1000));
        }
      },{threshold:[0,.5,1]});
      results.querySelectorAll("[data-discovery-session][data-public-dancer-id]").forEach(card=>discoveryGridObserver.observe(card));
    }
    document.addEventListener("click",event=>{
      const target = event.target instanceof Element ? event.target : null;
      const card = target?.closest("[data-discovery-session][data-public-dancer-id]");
      if (!card) return;
      const action = target.closest(".home-dancer-grid-link,[data-grid-profile-action],.home-discovery-feed-open-profile") ? "profile_click"
        : target.closest(".venue-directions-btn") ? "directions" : null;
      if (action) {
        void recordDiscoveryEvent(card.dataset.publicDancerId,discoveryCardPlacement(card),"impression");
        void recordDiscoveryEvent(card.dataset.publicDancerId,discoveryCardPlacement(card),action);
      }
    },true);
    function discoveryPlayedSeconds(ranges,start,end) {
      if (!(end>start)) return ranges.reduce((sum,range)=>sum+range[1]-range[0],0);
      ranges.push([start,end]); ranges.sort((a,b)=>a[0]-b[0]);
      const merged=[];
      for (const range of ranges) {
        const previous=merged.at(-1);
        if (previous && range[0]<=previous[1]) previous[1]=Math.max(previous[1],range[1]);
        else merged.push([...range]);
      }
      ranges.splice(0,ranges.length,...merged);
      return ranges.reduce((sum,range)=>sum+range[1]-range[0],0);
    }
    function trackDiscoveryVideo(item,video,slide) {
      if (!item.discovery) return;
      let last = 0, lastWall = 0, impressionWall = null;
      const watched = [];
      const reset = () => { last=video.currentTime; lastWall=performance.now(); };
      video.addEventListener("playing",reset);
      video.addEventListener("seeking",reset);
      video.addEventListener("timeupdate",()=>{
        const wall=performance.now(), delta=video.currentTime-last, elapsed=(wall-lastWall)/1000;
        if (document.visibilityState==="visible" && slide.classList.contains("is-active") && !video.paused && !video.seeking
          && !document.body.classList.contains("overlay-open") && delta>0 && delta<1.5 && elapsed>0 && elapsed<1.5) {
          // Count distinct parts of the timeline actually played. Seeking and
          // looping one fragment cannot manufacture a full-video completion.
          const start = Math.max(last,video.currentTime-elapsed);
          const played=discoveryPlayedSeconds(watched,start,video.currentTime);
          if (impressionWall===null) impressionWall=wall;
          void recordDiscoveryEvent(item.id,item.discovery,"impression");
          const sinceImpression=(wall-impressionWall)/1000;
          if (played>=Math.min(3,video.duration*.5) && sinceImpression>=Math.min(3,video.duration*.5)+.5) void recordDiscoveryEvent(item.id,item.discovery,"engaged");
          if (video.duration>0 && played>=video.duration*.9 && sinceImpression>=video.duration*.9+.5) void recordDiscoveryEvent(item.id,item.discovery,"completed");
        }
        reset();
      });
    }
