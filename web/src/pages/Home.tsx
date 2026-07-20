export function Home() {
  return (
    <div className="flex flex-col gap-4 p-4 items-center justify-center">
      <h1 className="text-2xl font-bold">Available Routes</h1>
      <ul className="list-none border border-gray-200 rounded-md px-4">
        <li className="border-b border-gray-200 p-2">
          <a href="/source/create" className="text-blue-500">
            Source Create
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/model/create" className="text-blue-500">
            Model Create
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/model/edit" className="text-blue-500">
            Model Edit
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/model/run" className="text-blue-500">
            Model Run
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/model/test" className="text-blue-500">
            Model Test
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/lightdash/preview-manager" className="text-blue-500">
            Lightdash Preview Manager
          </a>
        </li>
        <li className="border-b border-gray-200 p-2">
          <a href="/lightdash/dashboards-as-code" className="text-blue-500">
            Lightdash Dashboards as Code
          </a>
        </li>
        <li className="p-2">
          <a href="/query/control-center" className="text-blue-500">
            Query Control Center
          </a>
        </li>
      </ul>
    </div>
  );
}
