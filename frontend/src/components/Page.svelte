<script lang="ts">
  export let eyebrow = '';
  export let title = '';
  export let description = '';
</script>

<div class="hero">
  <div>
    <div class="eyebrow">{eyebrow}</div>
    <h2>{title}</h2>
    <p>{description}</p>
  </div>
  <slot name="actions" />
</div>
<slot />
