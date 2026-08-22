import { VERSUS_OBSIDIAN } from "../data/facts";

export function CompareTable() {
  return (
    <div className="compare-wrap">
      <table className="compare-table">
        <thead>
          <tr>
            <th> </th>
            <th>OpenOnyx</th>
            <th>Obsidian</th>
          </tr>
        </thead>
        <tbody>
          {VERSUS_OBSIDIAN.map((row) => (
            <tr key={row.item} className={row.win ? "is-win" : ""}>
              <th>{row.item}</th>
              <td>{row.us}</td>
              <td>{row.them}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
