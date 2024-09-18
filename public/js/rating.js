function openRatingModal(sellerId, sellerName) {
  document.getElementById('ratingModal').style.display = 'block';
  document.getElementById('modalSellerName').innerText = `Rate the Seller: ${sellerName}`;
  
  const stars = document.querySelectorAll('.star');
  let selectedValue = 0; // Start with a default value of 0

  stars.forEach(star => {
    star.addEventListener('click', () => {
      const value = star.getAttribute('data-value');
      selectedValue = value; // Capture selected value

      // Reset and set selected stars
      stars.forEach(star => {
        star.classList.remove('selected');
        if (star.getAttribute('data-value') <= value) {
          star.classList.add('selected');
        }
      });
      
      // Update submit button with the rating value (including 0)
      document.getElementById('submitRating').setAttribute('data-value', selectedValue);
    });
  });

  document.getElementById('submitRating').addEventListener('click', () => {
    const ratingValue = document.getElementById('submitRating').getAttribute('data-value') || 0; // Default to 0 if no stars are selected
    submitRating(sellerId, ratingValue);
  });
}

function closeRatingModal() {
  document.getElementById('ratingModal').style.display = 'none';
}

function submitRating(sellerId, ratingValue) {
  fetch(`/rate-seller/${sellerId}/${ratingValue}`, {
    method: 'POST'
  })
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      location.reload(); // Refresh to show the updated rating
    } else {
      alert('Error submitting rating. Please try again.');
    }
  });
}
