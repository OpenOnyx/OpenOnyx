type Props = {
  src?: string;
  poster: string;
  alt: string;
};

export function FilmFrame({ poster, alt }: Props) {
  return (
    <figure className="film-frame" tabIndex={0}>
      <img src={poster} alt={alt} className="film-still" />
      <span className="film-live">
        <i />
        live
      </span>
    </figure>
  );
}
