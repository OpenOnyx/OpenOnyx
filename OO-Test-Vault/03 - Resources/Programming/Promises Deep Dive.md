# 🤝 Promises Deep Dive

## States

- **Pending**: Initial state
- **Fulfilled**: Completed successfully
- **Rejected**: Failed

## Creating Promises

```javascript
const promise = new Promise((resolve, reject) => {
  // async operation
  if (success) resolve(value);
  else reject(error);
});
```

## Chaining

```javascript
fetchUser()
  .then(user => fetchPosts(user.id))
  .then(posts => renderPosts(posts))
  .catch(error => handleError(error))
  .finally(() => cleanup());
```

## Promise Methods

```javascript
// Wait for all
Promise.all([p1, p2, p3]);

// First to complete
Promise.race([p1, p2]);

// All settled (success or fail)
Promise.allSettled([p1, p2]);
```

## See Also

- [[Async Programming]]
- [[Event Loop]]
- [[Maps of Content]]
