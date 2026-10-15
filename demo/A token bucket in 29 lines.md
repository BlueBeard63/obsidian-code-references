%% Screenshot note for the README and the community listing. Open demo/ as a vault after `npm run demo`. The source= link is illustrative: it shows the "view source" header, there is no such repo. %%

A rate limiter only has to answer one question: may this request go ahead *now*? A token bucket answers it with three numbers and a timestamp.

Each `Bucket` holds up to [a burst of tokens](#bucket:10-12) and earns new ones at a steady rate. There is no background goroutine topping it up. Instead, [`Allow`](#bucket:16-29) does the refill lazily: [the time since the last call, times the rate](#bucket:20-22), capped at the burst size.

Spending is the easy part. [Less than a whole token means no](#bucket:24-26); otherwise [take one and let the request through](#bucket:27-28). [The mutex](#bucket:17-18) is what makes one bucket safe to share between handlers.

```go title="ratelimit/bucket.go" id="bucket" source="example/ratelimit@v1.0.0:bucket.go"
package ratelimit

import (
	"sync"
	"time"
)

type Bucket struct {
	mu     sync.Mutex
	tokens float64 // available right now
	burst  float64 // the most it can hold
	rate   float64 // tokens earned per second
	last   time.Time
}

func (b *Bucket) Allow() bool {
	b.mu.Lock()
	defer b.mu.Unlock()

	now := time.Now()
	b.tokens = min(b.burst, b.tokens+now.Sub(b.last).Seconds()*b.rate)
	b.last = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
```

> [!tip] Try it
> Hover any double-underlined phrase to light up its lines, click to jump to them, or Ctrl/Cmd-click to open them on GitHub.



test