// @ts-check

import assert from "node:assert/strict"
import {describe, expect, it} from "@velocious/testing"
import {generateProgramArtifactSet, parseProgram} from "../index.js"

describe("blocking TCP PHP stdlib linking", () => {
  it("links four distinct qualified providers for the reachable socket program", () => {
    const first = generateProgramArtifactSet({language: "php", program: parseProgram(fullProgram())})
    const second = generateProgramArtifactSet({language: "php", program: parseProgram(fullProgram())})

    assert.deepEqual(second, first)
    expect(first.artifacts.map(({path}) => path)).toEqual([
      "providers/php/semantifold/output.php",
      "providers/php/semantifold/resource.php",
      "providers/php/semantifold/socket-client.php",
      "providers/php/semantifold/text-stream.php",
      "semantifold/facade/ruby/socket.php",
      "semantifold/facade/ruby/output.php",
      "main.php"
    ])
    expect(first.metadata?.modules).toEqual([
      {identity: "semantifold.output", operations: ["v1_write_line"], version: "1.0.0"},
      {identity: "semantifold.resource", operations: ["v1_close"], version: "1.0.0"},
      {identity: "semantifold.socket-client", operations: ["v1_connect"], version: "1.0.0"},
      {identity: "semantifold.text-stream", operations: ["v1_read_line"], version: "1.0.0"}
    ])
    expect(first.metadata?.providers.map(({artifact, module}) => ({module, path: artifact.path}))).toEqual([
      {module: "semantifold.output", path: "providers/php/semantifold/output.php"},
      {module: "semantifold.resource", path: "providers/php/semantifold/resource.php"},
      {module: "semantifold.socket-client", path: "providers/php/semantifold/socket-client.php"},
      {module: "semantifold.text-stream", path: "providers/php/semantifold/text-stream.php"}
    ])
  })

  it("tree-shakes unused socket providers while retaining the exact selected type closure", () => {
    const output = generateProgramArtifactSet({language: "php", program: parseProgram({
      entryModule: "main",
      sources: [{filename: "main.rb", id: "main", language: "ruby", source: `require "socket"
module Main
  puts "only output"
end
`}]
    })})

    expect(output.artifacts.map(({path}) => path)).toEqual([
      "providers/php/semantifold/output.php", "semantifold/facade/ruby/output.php", "main.php"
    ])

    const socket = generateProgramArtifactSet({language: "php", program: parseProgram(closeOnlyProgram())})
    const providerPaths = socket.artifacts.filter(({path}) => path.startsWith("providers/")).map(({path}) => path)

    expect(providerPaths).toEqual([
      "providers/php/semantifold/resource.php", "providers/php/semantifold/socket-client.php"
    ])
  })
})

function fullProgram() {
  return {
    entryModule: "main",
    sources: [{filename: "main.rb", id: "main", language: "ruby", source: `require "socket"
module Main
  module_function
  # @return [void]
  def run()
    # @type [TCPSocket]
    socket = TCPSocket.new("127.0.0.1", 1234)
    begin
      begin
        begin
          # @type [String?]
          line = socket.gets
          if !line.nil?
            puts line
          end
        rescue WriteFailure => write_error
          socket.close
          return
        end
      rescue DecodeFailure => decode_error
        socket.close
        return
      end
    rescue ReadFailure => read_error
      socket.close
      return
    end
    socket.close
    return
  end
  run()
end
`}]
  }
}

function closeOnlyProgram() {
  return {
    entryModule: "main",
    sources: [{filename: "main.rb", id: "main", language: "ruby", source: `require "socket"
module Main
  module_function
  # @return [void]
  def run()
    # @type [TCPSocket]
    socket = TCPSocket.new("127.0.0.1", 1234)
    socket.close
    return
  end
  run()
end
`}]
  }
}
